import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, serializeMarker, type ApprovedPlanMarker, type RunMarker } from "../src/status/markers.js";
import { getStatus } from "../src/status/status.js";

describe("saf status integration", () => {
  it("derives Ready without .saf/runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-status-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, ".saf"));
    await writeFile(join(root, ".saf/config.yaml"), stringify(config));
    const result = await getStatus(42, root, { execute: executor(root), github: async () => success(adapter) });
    expect(result).toMatchObject({ ok: true, data: { issue: { number: 42 }, projectStatus: "Ready", derivedState: "Ready", nextAction: "saf build 42" } });
  });

  it("recovers the PR relation and Review state without .saf/runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-status-"));
    await mkdir(join(root, ".git")); await mkdir(join(root, ".saf"));
    await writeFile(join(root, ".saf/config.yaml"), stringify(config));
    const run: RunMarker = { version: 1, kind: "run", issue: 42, runId: "run-42", state: "succeeded", branch: "saf/42", pullRequest: 7 };
    const reviewAdapter: GitHubAdapter = {
      ...adapter,
      getIssue: async () => success({ number: 42, title: "Test", state: "open", body: "", comments: [
        { id: 1, body: serializeMarker(marker), createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" },
        { id: 2, body: serializeMarker(run), createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }
      ] }),
      getProjectItem: async () => success({ id: "item", status: "Review" }),
      getPullRequest: async () => success({ number: 7, state: "open", draft: true, merged: false, headSha: "a".repeat(40), branch: "saf/42", url: "https://example.test/7" }),
      getChecks: async () => success({ state: "success", total: 1, failing: [] })
    };
    const execute = executor(root, "saf/42");
    const result = await getStatus(42, root, { execute, github: async () => success(reviewAdapter) });
    expect(result).toMatchObject({ ok: true, data: { projectStatus: "Review", derivedState: "Review", pullRequest: { number: 7 } } });
  });
});

const marker: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: hashPlan("plan"), plan: "plan" };
const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { plansDirectory: "docs/plans" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1, tasksOnly: false }, review: { adapter: "ralphex-codex", externalReviewTool: "none" }, validation: { commands: ["pnpm check"] } };
const adapter: GitHubAdapter = {
  getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
  getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
  getIssue: async () => success({ number: 42, title: "Test", state: "open", body: "", comments: [{ id: 1, body: serializeMarker(marker), createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }] }),
  getProjectItem: async () => success({ id: "item", status: "Ready" }),
  getPullRequest: async () => { throw new Error("unexpected PR read"); },
  getChecks: async () => { throw new Error("unexpected checks read"); },
  setProjectItemStatus: async () => { throw new Error("unexpected mutation"); },
  createIssueComment: async () => { throw new Error("unexpected mutation"); },
  updateIssueComment: async () => { throw new Error("unexpected mutation"); },
  findPullRequestByBranch: async () => { throw new Error("unexpected read"); },
  createOrUpdateDraftPullRequest: async () => { throw new Error("unexpected mutation"); },
  addPullRequestToProject: async () => { throw new Error("unexpected mutation"); }
};

function executor(root: string, branch = "master") {
  return async (invocation: CommandInvocation) => {
    const args = invocation.args ?? [];
    let stdout = "";
    if (args[0] === "rev-parse") stdout = root;
    else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git";
    else if (args.includes("--show-current")) stdout = branch;
    else if (args.includes("--format=%(refname:short)")) stdout = `master\n${branch}`;
    return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
  };
}
