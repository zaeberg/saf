import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { gitValue } from "../build/git.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter, PullRequestDetails } from "../github/types.js";
import type { PromptAdapter } from "../prompt/prompt-adapter.js";
import { runCommand } from "../runner/command-runner.js";
import { parseMarkers, serializeMarker, type AcceptanceMarker } from "../status/markers.js";
import { readWorkflowFacts } from "../status/reader.js";
import { createReviewPacket, writeReviewPacket } from "./packet.js";
import { reviewDiff, type ReviewAnnotation } from "./revdiff.js";

const acceptanceContext = "saf/human-acceptance";
export interface ReviewOptions { issue: number; dryRun: boolean; cwd: string; confirmationSha?: string; interactive: boolean; }
export interface ReviewSummary { issue: number; state: "DryRun" | "Accepted"; pullRequest: number; sha: string; annotations: ReviewAnnotation[]; packetPath: string; }
export interface ReviewDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
  prompt: Pick<PromptAdapter, "input">;
  reviewer: typeof reviewDiff;
  writePacket: typeof writeReviewPacket;
}
const defaults: ReviewDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter, prompt: { input: async () => "" }, reviewer: reviewDiff, writePacket: writeReviewPacket };

export async function reviewIssue(options: ReviewOptions, dependencies: ReviewDependencies = defaults): Promise<CommandResult<ReviewSummary>> {
  if (!Number.isInteger(options.issue) || options.issue <= 0) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid Issue number: ${options.issue}`, remediation: "Pass a positive GitHub Issue number." }]);
  const git = await inspectGitContext(options.cwd, dependencies.execute);
  if (!git.ok) return git;
  const config = await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (!config.ok) return config;
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const facts = await readWorkflowFacts(config.data, options.issue, git.data.root, github.data, dependencies.execute);
  if (!facts.ok) return facts;
  const pullRequest = facts.data.pullRequest;
  if (!pullRequest || pullRequest.state !== "open" || !pullRequest.draft || pullRequest.merged || !facts.data.approvedPlan || facts.data.run?.state === "failed" || facts.data.markerFindings.length > 0) return failure([{ code: "REVIEW_STATE_INVALID", severity: "error", message: `Issue #${options.issue} has no valid open Draft PR with matching build evidence.`, remediation: `Run saf status ${options.issue} and resolve workflow drift before review.` }]);
  if (facts.data.checks?.state !== "success") return failure([{ code: "REVIEW_CI_BLOCKED", severity: "error", message: `CI is ${facts.data.checks?.state ?? "missing"} for ${pullRequest.headSha}.`, remediation: "Wait for successful CI or fix failing checks before acceptance." }]);
  if (facts.data.acceptance?.statusForCurrentSha) return success({ issue: options.issue, state: "Accepted", pullRequest: pullRequest.number, sha: pullRequest.headSha, annotations: [], packetPath: "" });
  const localHead = await gitValue(git.data.root, ["rev-parse", pullRequest.branch], dependencies.execute);
  if (!localHead.ok || localHead.data !== pullRequest.headSha) return failure([{ code: "REVIEW_STATE_INVALID", severity: "error", message: `Local branch ${pullRequest.branch} does not match remote head ${pullRequest.headSha}.`, remediation: "Fetch or check out the exact Pull Request head before review." }]);

  const packetPath = join(git.data.root, ".saf/runtime/review", `issue-${options.issue}-${pullRequest.headSha}.md`);
  const annotationsPath = join(git.data.root, ".saf/runtime/review", `issue-${options.issue}-${pullRequest.headSha}-annotations.md`);
  try { await dependencies.writePacket(packetPath, createReviewPacket(facts.data)); }
  catch { return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to write the temporary review packet.", remediation: "Check .saf/runtime permissions and retry." }]); }
  if (options.dryRun) return success({ issue: options.issue, state: "DryRun", pullRequest: pullRequest.number, sha: pullRequest.headSha, annotations: [], packetPath });

  const reviewed = await dependencies.reviewer(git.data.root, config.data.repository.defaultBranch, pullRequest.branch, packetPath, annotationsPath, dependencies.execute);
  if (!reviewed.ok) return reviewed;
  const blocking = reviewed.data.annotations.filter((annotation) => annotation.severity === "blocking");
  if (blocking.length > 0) return failure([{ code: "REVIEW_ANNOTATIONS_BLOCKING", severity: "error", message: `${blocking.length} blocking revdiff annotation(s) must be resolved.`, remediation: `Resolve findings in ${annotationsPath}, push a new commit and rerun saf review.` }]);

  const confirmation = options.confirmationSha ?? (options.interactive ? await dependencies.prompt.input(`Type current head SHA ${pullRequest.headSha} to accept`) : "");
  if (confirmation.trim() !== pullRequest.headSha) return failure([{ code: "REVIEW_CONFIRMATION_MISMATCH", severity: "error", message: "Typed SHA does not match the reviewed head SHA.", remediation: "Rerun saf review and type the complete current SHA." }]);
  const fresh = await github.data.getPullRequest(config.data.github.repository, pullRequest.number);
  if (!fresh.ok) return fresh;
  if (fresh.data.headSha !== pullRequest.headSha) return failure([{ code: "REVIEW_HEAD_CHANGED", severity: "error", message: `Pull Request head changed from ${pullRequest.headSha} to ${fresh.data.headSha} during review.`, remediation: "Review the new diff and accept its exact SHA." }]);

  const marker: AcceptanceMarker = { version: 1, kind: "human-acceptance", issue: options.issue, sha: pullRequest.headSha, acceptedAt: new Date().toISOString() };
  const published = await publishAcceptance(github.data, config.data.github.repository, fresh.data, marker);
  if (!published.ok) return published;
  const status = await github.data.createCommitStatus(config.data.github.repository, pullRequest.headSha, acceptanceContext, "success", `Human acceptance for Issue #${options.issue}`);
  if (!status.ok) return status;
  return success({ issue: options.issue, state: "Accepted", pullRequest: pullRequest.number, sha: pullRequest.headSha, annotations: reviewed.data.annotations, packetPath });
}

async function publishAcceptance(github: GitHubAdapter, repository: string, pullRequest: PullRequestDetails, marker: AcceptanceMarker): Promise<CommandResult<void>> {
  const parsed = parseMarkers(pullRequest.comments, marker.issue);
  if (parsed.acceptance?.sha === marker.sha && parsed.acceptanceCommentId) {
    const updated = await github.updateIssueComment(repository, parsed.acceptanceCommentId, serializeMarker(marker));
    return updated.ok ? success(undefined) : updated;
  }
  const created = await github.createIssueComment(repository, pullRequest.number, serializeMarker(marker));
  return created.ok ? success(undefined) : created;
}
