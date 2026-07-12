import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter, IssueDetails, PullRequestDetails } from "../src/github/types.js";
import { reviewIssue, type ReviewDependencies } from "../src/review/review.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, serializeMarker } from "../src/status/markers.js";

describe("saf review integration", () => {
  it("runs Ralphex review with configured Codex options and the original plan", async () => {
    const fixture = await reviewFixture();
    const ralphex = vi.fn(async () => success(undefined));
    const result = await reviewIssue({ issue: 42, dryRun: false, cwd: fixture.root, reviewModel: "gpt-5.4:high" }, dependencies(fixture, ralphex));
    expect(result).toMatchObject({ ok: true, data: { state: "Reviewed", pullRequest: 7, planPath: fixture.planPath } });
    expect(ralphex).toHaveBeenCalledWith(fixture.root, fixture.planPath, { baseRef: "master", externalReviewTool: "codex", reviewModel: "gpt-5.4:high" }, expect.any(Function));
  });

  it("does not run Ralphex during dry-run", async () => {
    const fixture = await reviewFixture();
    const ralphex = vi.fn(async () => success(undefined));
    const result = await reviewIssue({ issue: 42, dryRun: true, cwd: fixture.root }, dependencies(fixture, ralphex));
    expect(result).toMatchObject({ ok: true, data: { state: "DryRun" } });
    expect(ralphex).not.toHaveBeenCalled();
  });

  it("uses interactive review choices instead of configured defaults", async () => {
    const fixture = await reviewFixture();
    const ralphex = vi.fn(async () => success(undefined));
    const harness = dependencies(fixture, ralphex);
    harness.prompt.select.mockResolvedValueOnce("claude");
    harness.prompt.input.mockResolvedValueOnce("gpt-5.4:medium");
    const result = await reviewIssue({ issue: 42, dryRun: false, interactive: true, cwd: fixture.root }, harness);
    expect(result.ok).toBe(true);
    expect(ralphex).toHaveBeenCalledWith(fixture.root, fixture.planPath, { baseRef: "master", externalReviewTool: "claude", reviewModel: "gpt-5.4:medium" }, expect.any(Function));
  });
});

async function reviewFixture() {
  const root = await mkdtemp(join(tmpdir(), "saf-review-"));
  await mkdir(join(root, ".git")); await mkdir(join(root, ".saf")); await mkdir(join(root, "docs/plans"), { recursive: true });
  await writeFile(join(root, ".saf/config.yaml"), stringify(config));
  const planPath = join(root, "docs/plans/issue-42.md");
  await writeFile(planPath, plan);
  const approved = { version: 1 as const, kind: "approved-plan" as const, issue: 42, revision: 1, normalizationVersion: 1 as const, sha256: hashPlan(plan), plan, planPath: "docs/plans/issue-42.md" };
  const run = { version: 1 as const, kind: "run" as const, issue: 42, runId: "run-42", state: "succeeded" as const, branch: "saf/42", pullRequest: 7 };
  return { root, planPath, issue: { number: 42, title: "Review feature", state: "open", body: "Outcome", comments: [comment(1, serializeMarker(approved)), comment(2, serializeMarker(run))] } satisfies IssueDetails };
}

function dependencies(fixture: Awaited<ReturnType<typeof reviewFixture>>, ralphex: ReviewDependencies["ralphex"]) {
  const pullRequest: PullRequestDetails = { number: 7, state: "open", draft: true, merged: false, headSha: "a".repeat(40), branch: "saf/42", url: "https://example.test/7" };
  const adapter: GitHubAdapter = {
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }), getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
    getIssue: async () => success(fixture.issue), getProjectItem: async () => success({ id: "item", status: "Review" }), getPullRequest: async () => success(pullRequest), getChecks: async () => success({ state: "success", total: 1, failing: [] }),
    setProjectItemStatus: async () => success(undefined), createIssueComment: async () => success({ id: 1 }), updateIssueComment: async () => success({ id: 1 }), findPullRequestByBranch: async () => success(pullRequest), createOrUpdateDraftPullRequest: async () => success(pullRequest), addPullRequestToProject: async () => success(undefined)
  };
  const prompt = {
    input: vi.fn(async (_message: string, value = "") => value),
    select: vi.fn(async <T>(_message: string, _choices: readonly { name: string; value: T }[], value: T) => value)
  };
  return { execute: executor(fixture.root), github: async () => success(adapter), ralphex, validation: async () => success([]), prompt } satisfies ReviewDependencies;
}

function executor(root: string) { return async (invocation: CommandInvocation) => { const args = invocation.args ?? []; let stdout = ""; if (args[0] === "rev-parse") stdout = root; else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git"; else if (args[0] === "branch" && args[1] === "--show-current") stdout = "saf/42"; else if (args.includes("--format=%(refname:short)")) stdout = "master\nsaf/42"; return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false }); }; }
function comment(id: number, body: string) { return { id, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }; }
const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { plansDirectory: "docs/plans" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1, tasksOnly: false }, review: { adapter: "ralphex-codex", externalReviewTool: "codex" }, validation: { commands: ["pnpm check"] } };
const plan = "# Plan\n\n## Overview\n\nReview.\n\n## Implementation Steps\n\n- [ ] Review changes.\n\n## Solution Overview\n\nSafe.\n\n## Validation Commands\n\n```bash\npnpm check\n```\n";
