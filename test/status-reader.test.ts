import { describe, expect, it } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { hashPlan, serializeMarker, type AcceptanceMarker, type ApprovedPlanMarker, type RunMarker } from "../src/status/markers.js";
import { readWorkflowFacts } from "../src/status/reader.js";
import { deriveState } from "../src/status/reducer.js";

const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { plansDirectory: "docs/plans/active" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1 }, review: { adapter: "revdiff" }, validation: { commands: ["pnpm check"] } };
const approved: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: hashPlan("plan"), plan: "plan" };
const run: RunMarker = { version: 1, kind: "run", issue: 42, runId: "run-1", state: "succeeded", branch: "feat/42", pullRequest: 51 };

describe("workflow fact reader", () => {
  it("restores Ready without runtime files", async () => {
    const result = await readWorkflowFacts(config, 42, "/repo", adapter([serializeMarker(approved)]), execute);
    expect(result.ok).toBe(true);
    if (result.ok) expect(deriveState(result.data).state).toBe("Ready");
  });

  it("restores Review and detects stale acceptance", async () => {
    const stale: AcceptanceMarker = { version: 1, kind: "human-acceptance", issue: 42, sha: "b".repeat(40), acceptedAt: "2026-07-12T00:00:00.000Z" };
    const result = await readWorkflowFacts(config, 42, "/repo", adapter([serializeMarker(approved), serializeMarker(run)], [serializeMarker(stale)]), execute);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const derivation = deriveState(result.data);
      expect(derivation.state).toBe("Review");
      expect(derivation.findings).toContainEqual(expect.objectContaining({ code: "STALE_ACCEPTANCE" }));
    }
  });
});

function adapter(issueMarkerBodies: string[], prMarkerBodies: string[] = []): GitHubAdapter {
  return {
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
    getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
    getIssue: async () => success({ number: 42, title: "Test", state: "open", body: "", comments: issueMarkerBodies.map((body, index) => ({ id: index + 1, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" })) }),
    getProjectItem: async () => success({ id: "item", status: issueMarkerBodies.some((body) => body.includes('"kind": "run"')) ? "Review" : "Ready" }),
    getPullRequest: async () => success({ number: 51, state: "open", draft: true, merged: false, headSha: "a".repeat(40), branch: "feat/42", url: "url", comments: prMarkerBodies.map((body, index) => ({ id: index + 10, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" })) }),
    getChecks: async () => success({ state: "success", total: 1, failing: [] }),
    getCommitStatus: async (_repository, sha) => success({ present: false, sha }),
    setProjectItemStatus: async () => success(undefined),
    createIssueComment: async () => success({ id: 1 }),
    updateIssueComment: async () => success({ id: 1 }),
    findPullRequestByBranch: async () => success(null),
    createOrUpdateDraftPullRequest: async () => { throw new Error("unexpected mutation"); },
    addPullRequestToProject: async () => success(undefined),
    createCommitStatus: async () => success(undefined)
  };
}

async function execute(invocation: CommandInvocation) {
  const args = invocation.args ?? [];
  const stdout = args.includes("--show-current") ? "feat/42\n" : args.includes("-r") ? "origin/feat/42\n" : "master\nfeat/42\n";
  return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
}
