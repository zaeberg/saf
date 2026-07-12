import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter, IssueDetails, PullRequestDetails } from "../src/github/types.js";
import { reviewIssue } from "../src/review/review.js";
import type { ReviewAnnotation } from "../src/review/revdiff.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, parseMarkers, serializeMarker } from "../src/status/markers.js";

describe("saf review integration", () => {
  it("publishes visible acceptance and exact-SHA status after non-blocking review", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture, { oldAcceptanceSha: "b".repeat(40) });
    const reviewer = vi.fn(async () => success({ annotations: [annotation("non-blocking")] }));
    const result = await reviewIssue(options(fixture), dependencies(fixture, github.adapter, reviewer));
    expect(result).toMatchObject({ ok: true, data: { state: "Accepted", sha: fixture.sha, pullRequest: 7 } });
    expect(github.statuses).toEqual([{ sha: fixture.sha, context: "saf/human-acceptance", state: "success" }]);
    expect(github.pr.comments).toHaveLength(2);
    expect(github.pr.comments.at(-1)?.body).toContain("**SAF · Human acceptance**");
    expect(parseMarkers(github.pr.comments, 42).acceptance).toMatchObject({ sha: fixture.sha });
    expect(reviewer).toHaveBeenCalledWith(fixture.root, "master", "saf/42", expect.stringContaining(".saf/runtime/review/"), expect.stringContaining("annotations.md"), expect.any(Function));
  });

  it.each(["pending", "failure", "missing"] as const)("blocks acceptance when CI is %s", async (ciState) => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture, { ciState });
    const reviewer = vi.fn(async () => success({ annotations: [] }));
    const result = await reviewIssue(options(fixture), dependencies(fixture, github.adapter, reviewer));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "REVIEW_CI_BLOCKED" }] });
    expect(reviewer).not.toHaveBeenCalled();
    expect(github.statuses).toEqual([]);
  });

  it("blocks acceptance on blocking annotations", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture);
    const result = await reviewIssue(options(fixture), dependencies(fixture, github.adapter, async () => success({ annotations: [annotation("blocking")] })));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "REVIEW_ANNOTATIONS_BLOCKING" }] });
    expect(github.statuses).toEqual([]);
  });

  it("blocks acceptance when typed SHA does not match", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture);
    const result = await reviewIssue({ ...options(fixture), confirmationSha: "b".repeat(40) }, dependencies(fixture, github.adapter));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "REVIEW_CONFIRMATION_MISMATCH" }] });
    expect(github.statuses).toEqual([]);
  });

  it("blocks review when the local branch is not the remote PR head", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture);
    const base = executor(fixture.root);
    const execute = async (invocation: CommandInvocation) => invocation.args?.[0] === "rev-parse" && invocation.args[1] === "saf/42"
      ? success<CommandExecution>({ command: "git", args: invocation.args, exitCode: 0, stdout: "d".repeat(40), stderr: "", dryRun: false })
      : base(invocation);
    const result = await reviewIssue(options(fixture), { ...dependencies(fixture, github.adapter), execute });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "REVIEW_STATE_INVALID" }] });
    expect(github.statuses).toEqual([]);
  });

  it("re-reads the PR and blocks publication when head changes during review", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture, { changedHead: "c".repeat(40) });
    const result = await reviewIssue(options(fixture), dependencies(fixture, github.adapter));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "REVIEW_HEAD_CHANGED" }] });
    expect(github.statuses).toEqual([]);
    expect(github.pr.comments).toHaveLength(0);
  });

  it("writes the packet but does not review or mutate during dry-run", async () => {
    const fixture = await reviewFixture();
    const github = statefulAdapter(fixture);
    const reviewer = vi.fn(async () => success({ annotations: [] }));
    const writePacket = vi.fn(async () => undefined);
    const result = await reviewIssue({ ...options(fixture), dryRun: true }, { ...dependencies(fixture, github.adapter, reviewer), writePacket });
    expect(result).toMatchObject({ ok: true, data: { state: "DryRun", sha: fixture.sha } });
    expect(writePacket).toHaveBeenCalledOnce();
    expect(reviewer).not.toHaveBeenCalled();
    expect(github.statuses).toEqual([]);
  });
});

async function reviewFixture() {
  const root = await mkdtemp(join(tmpdir(), "saf-review-"));
  await mkdir(join(root, ".git")); await mkdir(join(root, ".saf"));
  await writeFile(join(root, ".saf/config.yaml"), stringify(config));
  const sha = "a".repeat(40);
  const approved = { version: 1 as const, kind: "approved-plan" as const, issue: 42, revision: 1, normalizationVersion: 1 as const, sha256: hashPlan(plan), plan };
  const run = { version: 1 as const, kind: "run" as const, issue: 42, runId: "run-42", state: "succeeded" as const, branch: "saf/42", pullRequest: 7 };
  return { root, sha, approved, run };
}

function statefulAdapter(fixture: Awaited<ReturnType<typeof reviewFixture>>, behavior: { ciState?: "success" | "failure" | "pending" | "missing"; changedHead?: string; oldAcceptanceSha?: string } = {}) {
  const issue: IssueDetails = { number: 42, title: "Review feature", state: "open", body: "Expected outcome", comments: [comment(1, serializeMarker(fixture.approved)), comment(2, serializeMarker(fixture.run))] };
  const pr: PullRequestDetails = { number: 7, title: "Review feature", body: "- Validation:\n  - `pnpm check`: exit 0", state: "open", draft: true, merged: false, headSha: fixture.sha, branch: "saf/42", url: "https://example.test/pr/7", comments: [], changedFiles: ["src/review.ts"] };
  if (behavior.oldAcceptanceSha) pr.comments.push(comment(10, serializeMarker({ version: 1, kind: "human-acceptance", issue: 42, sha: behavior.oldAcceptanceSha, acceptedAt: "2026-07-11T00:00:00.000Z" })));
  const statuses: Array<{ sha: string; context: string; state: string }> = [];
  let reads = 0;
  const adapter: GitHubAdapter = {
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }), getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
    getIssue: async () => success(issue), getProjectItem: async () => success({ id: "item", status: "Review" }),
    getPullRequest: async () => { reads += 1; return success(reads > 1 && behavior.changedHead ? { ...pr, headSha: behavior.changedHead } : pr); },
    getChecks: async () => success({ state: behavior.ciState ?? "success", total: 1, failing: [] }), getCommitStatus: async (_repository, sha) => success({ present: false, sha }),
    setProjectItemStatus: async () => success(undefined),
    createIssueComment: async (_repository, _issue, body) => { const id = pr.comments.length + 10; pr.comments.push(comment(id, body)); return success({ id }); },
    updateIssueComment: async (_repository, id, body) => { const index = pr.comments.findIndex((item) => item.id === id); pr.comments[index] = comment(id, body); return success({ id }); },
    findPullRequestByBranch: async () => success(pr), createOrUpdateDraftPullRequest: async () => success(pr), addPullRequestToProject: async () => success(undefined),
    createCommitStatus: async (_repository, sha, context, state) => { statuses.push({ sha, context, state }); return success(undefined); }
  };
  return { adapter, issue, pr, statuses };
}

function dependencies(fixture: Awaited<ReturnType<typeof reviewFixture>>, adapter: GitHubAdapter, reviewer = async () => success({ annotations: [] as ReviewAnnotation[] })) {
  return { execute: executor(fixture.root), github: async () => success(adapter), prompt: { input: async () => fixture.sha }, reviewer, writePacket: async () => undefined };
}
function options(fixture: Awaited<ReturnType<typeof reviewFixture>>) { return { issue: 42, dryRun: false, cwd: fixture.root, confirmationSha: fixture.sha, interactive: false }; }
function annotation(severity: "blocking" | "non-blocking"): ReviewAnnotation { return { location: "src/a.ts:1 (+)", message: "finding", severity }; }
function comment(id: number, body: string) { return { id, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }; }
function executor(root: string) { return async (invocation: CommandInvocation) => { const args = invocation.args ?? []; let stdout = ""; if (args[0] === "rev-parse" && args[1] === "--show-toplevel") stdout = root; else if (args[0] === "rev-parse" && args[1] === "saf/42") stdout = "a".repeat(40); else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git"; else if (args[0] === "branch" && args[1] === "--show-current") stdout = "saf/42"; else if (args.includes("--format=%(refname:short)")) stdout = "master\nsaf/42"; return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false }); }; }
const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { projectFile: "PROJECT.md", agentsFile: "AGENTS.md", plansDirectory: "docs/plans/active" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1 }, review: { adapter: "revdiff" }, validation: { commands: ["pnpm check"] } };
const plan = "# Plan\n\n## Acceptance criteria\n\n- Works as requested\n";
