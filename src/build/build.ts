import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import type { SafConfigV1 } from "../config/schema.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter, PullRequestDetails } from "../github/types.js";
import { runCommand } from "../runner/command-runner.js";
import { parseMarkers, serializeMarker, type RunMarker } from "../status/markers.js";
import { readWorkflowFacts } from "../status/reader.js";
import { deriveState } from "../status/reducer.js";
import { checkBuildTools, runRalphex, runValidation, type ValidationEvidence } from "./execution.js";
import { checkWorkspace, ensureRunBranch, gitValue, pushBranch } from "./git.js";
import { acquireRunLock } from "./lock.js";

export interface BuildOptions { issue: number; dryRun: boolean; cwd: string; }
export interface BuildSummary { issue: number; state: "DryRun" | "Review"; runId: string; branch: string; pullRequest: number | null; validation: ValidationEvidence[]; }
export interface BuildDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
  ralphex: typeof runRalphex;
  validation: typeof runValidation;
}
const defaults: BuildDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter, ralphex: runRalphex, validation: runValidation };

export async function buildIssue(options: BuildOptions, dependencies: BuildDependencies = defaults): Promise<CommandResult<BuildSummary>> {
  if (!Number.isInteger(options.issue) || options.issue <= 0) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid Issue number: ${options.issue}`, remediation: "Pass a positive GitHub Issue number." }]);
  const git = await inspectGitContext(options.cwd, dependencies.execute);
  if (!git.ok) return git;
  const config = await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (!config.ok) return config;
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const facts = await readWorkflowFacts(config.data, options.issue, git.data.root, github.data, dependencies.execute);
  if (!facts.ok) return facts;
  const derived = deriveState(facts.data);
  if (derived.state === "Review" && facts.data.pullRequest) return success(summary(options.issue, "Review", facts.data.run!.runId, facts.data.run!.branch, facts.data.pullRequest, []));
  const recoverable = facts.data.run && ["Running", "Blocked"].includes(derived.state);
  if (derived.state !== "Ready" && !recoverable) return failure([{ code: "BUILD_STATE_INVALID", severity: "error", message: `Issue #${options.issue} cannot build from ${derived.state}.`, remediation: derived.blockers.map((finding) => finding.message).join(" ") || "Approve a valid plan first." }]);
  const plan = facts.data.approvedPlan;
  if (!plan || facts.data.markerFindings.some((finding) => finding.code === "PLAN_HASH_MISMATCH")) return failure([{ code: "BUILD_STATE_INVALID", severity: "error", message: "A valid approved plan is required.", remediation: `Run saf shape ${options.issue}.` }]);
  const tools = await checkBuildTools(git.data.root, dependencies.execute);
  if (!tools.ok) return tools;
  if (!facts.data.run) {
    const workspace = await checkWorkspace(git.data.root, plan.planPath, dependencies.execute);
    if (!workspace.ok) return workspace;
  }
  const runId = facts.data.run?.runId ?? `${options.issue}-${plan.sha256.slice(0, 12)}`;
  const branch = facts.data.run?.branch ?? `saf/${options.issue}-${plan.sha256.slice(0, 12)}`;
  if (options.dryRun) return success({ issue: options.issue, state: "DryRun", runId, branch, pullRequest: facts.data.pullRequest?.number ?? null, validation: [] });

  const lock = await acquireRunLock(join(git.data.root, ".saf/runtime/build.lock"), options.issue);
  if (!lock.ok) return lock;
  let runCommentIds = parseMarkers(facts.data.issue.comments, options.issue).runCommentIds ?? [];
  let currentMarker: RunMarker = facts.data.run ?? { version: 1, kind: "run", issue: options.issue, runId, state: "started", branch, planRevision: plan.revision, planSha256: plan.sha256 };
  try {
    const baseSha = await gitValue(git.data.root, ["rev-parse", "HEAD"], dependencies.execute);
    if (!baseSha.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "git", baseSha);
    if (!facts.data.run) {
      currentMarker = { ...currentMarker, baseSha: baseSha.data };
      const published = await publishRun(github.data, config.data.github.repository, options.issue, currentMarker, runCommentIds);
      if (!published.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "evidence", published);
      runCommentIds = published.data;
      const running = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Running");
      if (!running.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "project", running);
    }
    const runtimeDirectory = join(git.data.root, ".saf/runtime/build", runId);
    const planPath = join(runtimeDirectory, "approved-plan.md");
    try {
      await mkdir(runtimeDirectory, { recursive: true });
      await writeFile(planPath, plan.plan, "utf8");
    } catch {
      return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "runtime", failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to materialize the approved plan in SAF runtime.", remediation: "Check .saf/runtime permissions and retry." }]));
    }

    const shouldExecute = currentMarker.state === "started" || currentMarker.failurePhase === "execution";
    if (shouldExecute) {
      const execution = await dependencies.ralphex(git.data.root, planPath, branch, dependencies.execute);
      if (!execution.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "execution", execution);
      currentMarker = { ...currentMarker, state: "succeeded", completedAt: new Date().toISOString() };
      const published = await publishRun(github.data, config.data.github.repository, options.issue, currentMarker, runCommentIds);
      if (!published.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "evidence", published);
      runCommentIds = published.data;
    }

    if (branch === config.data.repository.defaultBranch) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "git", failure([{ code: "BRANCH_INVALID", severity: "error", message: "Implementation branch cannot be the default branch.", remediation: "Inspect the run marker before retrying." }]));
    const checkedOut = await ensureRunBranch(git.data.root, branch, facts.data.git.localBranches, facts.data.git.remoteBranches, dependencies.execute);
    if (!checkedOut.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "git", checkedOut);
    const commits = await gitValue(git.data.root, ["rev-list", "--count", `${config.data.repository.defaultBranch}..HEAD`], dependencies.execute);
    if (!commits.ok || Number(commits.data) < 1) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "git", failure([{ code: "BRANCH_INVALID", severity: "error", message: "Implementation branch has no commits over default branch.", remediation: "Complete the approved plan before creating a PR." }]));
    const clean = await checkWorkspace(git.data.root, plan.planPath, dependencies.execute);
    if (!clean.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "git", clean);
    const validation = await dependencies.validation(git.data.root, config.data.validation.commands, dependencies.execute);
    if (!validation.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "validation", validation);
    const pushed = await pushBranch(git.data.root, branch, dependencies.execute);
    if (!pushed.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "push", pushed);

    const pr = await github.data.createOrUpdateDraftPullRequest(config.data.github.repository, { title: facts.data.issue.title, body: pullRequestBody(options.issue, plan.revision, plan.sha256, runId, validation.data), branch, base: config.data.repository.defaultBranch });
    if (!pr.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "pull-request", pr);
    if (pr.data.nodeId) {
      const added = await github.data.addPullRequestToProject(config.data.github.project, config.data.github.repository, pr.data.nodeId);
      if (!added.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "project", added);
    }
    const recoveredMarker = { ...currentMarker };
    delete recoveredMarker.failurePhase;
    currentMarker = { ...recoveredMarker, state: "succeeded", pullRequest: pr.data.number, completedAt: new Date().toISOString() };
    const finalMarker = await publishRun(github.data, config.data.github.repository, options.issue, currentMarker, runCommentIds);
    if (!finalMarker.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "evidence", finalMarker);
    const review = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Review");
    if (!review.ok) return await failBuild(github.data, config.data, facts.data.projectItem.id, currentMarker, runCommentIds, "project", review);
    return success(summary(options.issue, "Review", runId, branch, pr.data, validation.data));
  } finally { await lock.data.release(); }
}

async function publishRun(github: GitHubAdapter, repository: string, issue: number, marker: RunMarker, ids: number[]): Promise<CommandResult<number[]>> {
  const body = serializeMarker(marker);
  if (ids.length === 0) {
    const created = await github.createIssueComment(repository, issue, body);
    return created.ok ? success([created.data.id]) : created;
  }
  for (const id of ids) { const updated = await github.updateIssueComment(repository, id, body); if (!updated.ok) return updated; }
  return success(ids);
}

async function failBuild<T>(github: GitHubAdapter, config: SafConfigV1, itemId: string, marker: RunMarker, ids: number[], phase: string, result: CommandResult<T>): Promise<CommandResult<never>> {
  const failed: RunMarker = { ...marker, state: "failed", failurePhase: phase, completedAt: new Date().toISOString() };
  await publishRun(github, config.github.repository, failed.issue, failed, ids);
  await github.setProjectItemStatus(config.github.project, config.github.repository, itemId, "Blocked");
  return result.ok ? failure([{ code: "COMMAND_FAILED", severity: "error", message: `Build failed during ${phase}.`, remediation: "Inspect evidence and rerun saf build." }]) : result;
}

function pullRequestBody(issue: number, revision: number, sha: string, runId: string, validation: ValidationEvidence[]): string {
  return [`Closes #${issue}`, "", "## SAF build evidence", `- Approved plan: r${revision} (\`${sha}\`)`, `- Run: \`${runId}\``, "- Validation:", ...validation.map((item) => `  - \`${item.command}\`: exit ${item.exitCode}`)].join("\n");
}

function summary(issue: number, state: "Review", runId: string, branch: string, pr: PullRequestDetails, validation: ValidationEvidence[]): BuildSummary {
  return { issue, state, runId, branch, pullRequest: pr.number, validation };
}
