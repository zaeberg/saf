import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, serializeMarker, type ApprovedPlanMarker } from "../src/status/markers.js";
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
});

const marker: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: hashPlan("plan"), plan: "plan" };
const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { projectFile: "PROJECT.md", agentsFile: "AGENTS.md", plansDirectory: "docs/plans/active" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1 }, review: { adapter: "revdiff" }, validation: { commands: ["pnpm check"] } };
const adapter: GitHubAdapter = {
  getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
  getProject: async () => success({ id: "project", title: "SAF", statusOptions: [] }),
  getIssue: async () => success({ number: 42, title: "Test", state: "open", body: "", comments: [{ id: 1, body: serializeMarker(marker), createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }] }),
  getProjectItem: async () => success({ id: "item", status: "Ready" }),
  getPullRequest: async () => { throw new Error("unexpected PR read"); },
  getChecks: async () => { throw new Error("unexpected checks read"); },
  getCommitStatus: async () => { throw new Error("unexpected status read"); }
};

function executor(root: string) {
  return async (invocation: CommandInvocation) => {
    const args = invocation.args ?? [];
    let stdout = "";
    if (args[0] === "rev-parse") stdout = root;
    else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git";
    else if (args.includes("--show-current")) stdout = "master";
    else if (args.includes("--format=%(refname:short)")) stdout = "master";
    return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
  };
}
