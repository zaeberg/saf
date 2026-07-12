import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { buildIssue } from "../src/build/build.js";
import type { ValidationEvidence } from "../src/build/execution.js";
import type { SafConfigV1 } from "../src/config/schema.js";
import { failure, success } from "../src/contracts/result.js";
import type { GitHubAdapter, IssueDetails, PullRequestDetails } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, parseMarkers, serializeMarker, type RunMarker } from "../src/status/markers.js";

describe("saf build integration", () => {
  it("executes an approved plan, validates, pushes and creates exactly one Draft PR", async () => {
    const fixture = await buildFixture();
    const github = statefulAdapter(fixture.approvedComment);
    const harness = dependencies(fixture.root, github.adapter);
    const first = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);

    expect(first).toMatchObject({ ok: true, data: { state: "Review", branch: fixture.branch, pullRequest: 7 } });
    expect(github.statuses).toEqual(["Running", "Review"]);
    expect(github.prInputs).toHaveLength(1);
    expect(github.prInputs[0]).toMatchObject({ branch: fixture.branch, base: "master" });
    expect(github.prInputs[0]?.body).toContain("pnpm check");
    expect(github.projectAdds).toEqual(["PR_node"]);
    expect(harness.ralphex).toHaveBeenCalledOnce();
    expect(harness.ralphex).toHaveBeenCalledWith(fixture.root, fixture.planPath, fixture.branch, { tasksOnly: false }, expect.any(Function));
    expect(harness.pushes()).toEqual([["push", "--set-upstream", "origin", fixture.branch]]);
    expect(parseMarkers(github.issue.comments, 42).run).toMatchObject({ state: "succeeded", pullRequest: 7, branch: fixture.branch });
    expect(github.issue.comments.at(-1)?.body).toContain("**SAF · Build run**");

    const second = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);
    expect(second).toMatchObject({ ok: true, data: { state: "Review", pullRequest: 7 } });
    expect(harness.ralphex).toHaveBeenCalledOnce();
    expect(github.prInputs).toHaveLength(1);
    expect(github.issue.comments).toHaveLength(2);
  });

  it("records validation failure and moves the item to Blocked without creating a PR", async () => {
    const fixture = await buildFixture();
    const github = statefulAdapter(fixture.approvedComment);
    const harness = dependencies(fixture.root, github.adapter, true);
    const result = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "VALIDATION_FAILED" }] });
    expect(github.statuses).toEqual(["Running", "Blocked"]);
    expect(github.prInputs).toEqual([]);
    expect(harness.pushes()).toEqual([]);
    expect(parseMarkers(github.issue.comments, 42).run).toMatchObject({ state: "failed", failurePhase: "validation" });
  });

  it("does not mutate or execute during dry-run", async () => {
    const fixture = await buildFixture();
    const github = statefulAdapter(fixture.approvedComment);
    const harness = dependencies(fixture.root, github.adapter);
    const result = await buildIssue({ issue: 42, dryRun: true, cwd: fixture.root }, harness.dependencies);
    expect(result).toMatchObject({ ok: true, data: { state: "DryRun", branch: fixture.branch } });
    expect(github.statuses).toEqual([]);
    expect(github.prInputs).toEqual([]);
    expect(harness.ralphex).not.toHaveBeenCalled();
    expect(harness.prompt.select).not.toHaveBeenCalled();
    expect(harness.prompt.input).not.toHaveBeenCalled();
  });

  it("uses interactive build choices instead of configured defaults", async () => {
    const fixture = await buildFixture();
    const github = statefulAdapter(fixture.approvedComment);
    const harness = dependencies(fixture.root, github.adapter);
    harness.prompt.select.mockResolvedValueOnce(true);
    harness.prompt.input.mockResolvedValueOnce("gpt-5.4:high");
    const result = await buildIssue({ issue: 42, dryRun: false, interactive: true, cwd: fixture.root }, harness.dependencies);
    expect(result.ok).toBe(true);
    expect(harness.ralphex).toHaveBeenCalledWith(fixture.root, fixture.planPath, fixture.branch, { tasksOnly: true, taskModel: "gpt-5.4:high" }, expect.any(Function));
  });

  it("recovers after execution without running Ralphex twice", async () => {
    const fixture = await buildFixture();
    const run: RunMarker = { version: 1, kind: "run", issue: 42, runId: fixture.runId, state: "succeeded", branch: fixture.branch, planRevision: 1, planSha256: fixture.sha };
    const github = statefulAdapter(fixture.approvedComment, serializeMarker(run), "Running");
    const harness = dependencies(fixture.root, github.adapter);
    harness.setBranch(fixture.branch);
    const result = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);
    expect(result).toMatchObject({ ok: true, data: { state: "Review", pullRequest: 7 } });
    expect(harness.ralphex).not.toHaveBeenCalled();
    expect(github.statuses).toEqual(["Review"]);
  });

  it("recovers an interrupted Ralphex execution on the next build", async () => {
    const fixture = await buildFixture();
    const github = statefulAdapter(fixture.approvedComment);
    const harness = dependencies(fixture.root, github.adapter);
    harness.ralphex.mockResolvedValueOnce(failure([{ code: "COMMAND_CANCELLED", severity: "error", message: "interrupted", remediation: "retry" }]));
    const interrupted = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);
    expect(interrupted).toMatchObject({ ok: false, diagnostics: [{ code: "COMMAND_CANCELLED" }] });
    expect(parseMarkers(github.issue.comments, 42).run).toMatchObject({ state: "failed", failurePhase: "execution" });
    await writeFile(fixture.planPath, plan.replace("- [ ] Implement.", "- [x] Implement."));
    const recovered = await buildIssue({ issue: 42, dryRun: false, cwd: fixture.root }, harness.dependencies);
    expect(recovered).toMatchObject({ ok: true, data: { state: "Review", pullRequest: 7 } });
    expect(harness.ralphex).toHaveBeenCalledTimes(2);
    expect(github.statuses).toEqual(["Running", "Blocked", "Review"]);
  });
});

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), "saf-build-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".saf"));
  await mkdir(join(root, "docs/plans"), { recursive: true });
  await writeFile(join(root, ".saf/config.yaml"), stringify(config));
  const planPath = join(root, "docs/plans/20260713-issue-pr-templates.md");
  await writeFile(planPath, plan);
  const sha = hashPlan(plan);
  const approvedComment = serializeMarker({ version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: sha, plan, planPath: "docs/plans/20260713-issue-pr-templates.md" });
  return { root, planPath, sha, approvedComment, runId: `42-${sha.slice(0, 12)}`, branch: "issue-pr-templates/42" };
}

function statefulAdapter(approved: string, run?: string, initialStatus = "Ready") {
  const statuses: string[] = [];
  const prInputs: Array<{ title: string; body: string; branch: string; base: string }> = [];
  const projectAdds: string[] = [];
  const issue: IssueDetails = { number: 42, title: "Implement build", state: "open", body: "Outcome", comments: [comment(1, approved)] };
  if (run) issue.comments.push(comment(2, run));
  let status = initialStatus;
  let pullRequest: PullRequestDetails | null = null;
  const adapter: GitHubAdapter = {
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
    getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
    getIssue: async () => success(issue),
    getProjectItem: async () => success({ id: "item", status }),
    getPullRequest: async () => pullRequest ? success(pullRequest) : failure([{ code: "GITHUB_NOT_FOUND", severity: "error", message: "missing", remediation: "retry" }]),
    getChecks: async () => success({ state: "success", total: 1, failing: [] }),
    setProjectItemStatus: async (_project, _repository, _item, next) => { status = next; statuses.push(next); return success(undefined); },
    createIssueComment: async (_repository, _issue, body) => { const id = issue.comments.length + 1; issue.comments.push(comment(id, body)); return success({ id }); },
    updateIssueComment: async (_repository, id, body) => { const index = issue.comments.findIndex((item) => item.id === id); issue.comments[index] = comment(id, body); return success({ id }); },
    findPullRequestByBranch: async () => success(pullRequest),
    createOrUpdateDraftPullRequest: async (_repository, input) => { prInputs.push(input); const created: PullRequestDetails = { number: 7, nodeId: "PR_node", state: "open", draft: true, merged: false, headSha: "b".repeat(40), branch: input.branch, url: "https://github.test/pr/7" }; pullRequest = created; return success(created); },
    addPullRequestToProject: async (_project, _repository, nodeId) => { projectAdds.push(nodeId); return success(undefined); }
  };
  return { adapter, issue, statuses, prInputs, projectAdds };
}

function dependencies(root: string, adapter: GitHubAdapter, failValidation = false) {
  let branch = "master";
  const invocations: CommandInvocation[] = [];
  const execute = async (invocation: CommandInvocation) => {
    invocations.push(invocation);
    const args = invocation.args ?? [];
    let stdout = "";
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") stdout = root;
    else if (args[0] === "rev-parse" && args[1] === "HEAD") stdout = "a".repeat(40);
    else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git";
    else if (args[0] === "branch" && args[1] === "--show-current") stdout = branch;
    else if (args.includes("--format=%(refname:short)")) stdout = branch === "master" ? "master" : `master\n${branch}`;
    else if (args[0] === "status") stdout = "";
    else if (args[0] === "rev-list") stdout = "1";
    else if (invocation.command === "ralphex" || invocation.command === "codex") stdout = "1.0.0";
    return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
  };
  const ralphex = vi.fn(async () => { branch = "issue-pr-templates/42"; return success(undefined); });
  const validation = vi.fn(async () => failValidation
    ? failure<ValidationEvidence[]>([{ code: "VALIDATION_FAILED", severity: "error", message: "tests failed", remediation: "fix" }])
    : success([{ command: "pnpm check", exitCode: 0, completedAt: "2026-07-12T00:00:00Z" }]));
  const prompt = {
    input: vi.fn(async (_message: string, value = "") => value),
    select: vi.fn(async <T>(_message: string, _choices: readonly { name: string; value: T }[], value: T) => value)
  };
  return {
    dependencies: { execute, github: async () => success(adapter), ralphex, validation, prompt },
    ralphex,
    prompt,
    setBranch(value: string) { branch = value; },
    pushes: () => invocations.filter((item) => item.command === "git" && item.args?.[0] === "push").map((item) => item.args)
  };
}

function comment(id: number, body: string) { return { id, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }; }

const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { plansDirectory: "docs/plans" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1, tasksOnly: false }, review: { adapter: "ralphex-codex", externalReviewTool: "codex" }, validation: { commands: ["pnpm check"] } };
const plan = "# Plan\n\n## Overview\n\nImplement build.\n\n## Implementation Steps\n\n- [ ] Implement.\n\n## Solution Overview\n\nComplete.\n\n## Validation Commands\n\n```bash\npnpm check\n```\n";
