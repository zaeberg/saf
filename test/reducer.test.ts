import { describe, expect, it } from "vitest";
import type { WorkflowFacts } from "../src/status/facts.js";
import { hashPlan, type ApprovedPlanMarker, type RunMarker } from "../src/status/markers.js";
import { deriveState } from "../src/status/reducer.js";

const approvedPlan: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: hashPlan("plan"), plan: "plan" };
const run: RunMarker = { version: 1, kind: "run", issue: 42, runId: "run-1", state: "started", branch: "feat/42", pullRequest: 51 };

describe("workflow reducer", () => {
  it.each([
    ["Inbox", facts()],
    ["Shaping", facts({ projectStatus: "Shaping" })],
    ["Ready", facts({ projectStatus: "Ready", approvedPlan })],
    ["Running", facts({ projectStatus: "Running", run: { ...run, pullRequest: undefined } })],
    ["Review", facts({ projectStatus: "Review", run, pullRequest: pr() })],
    ["Done", facts({ projectStatus: "Done", run, pullRequest: pr({ merged: true, state: "closed" }) })],
    ["Cancelled", facts({ issueState: "closed" })]
  ] as const)("derives %s", (expected, input) => {
    expect(deriveState(input).state).toBe(expected);
  });

  it("blocks Project Done without a merged PR", () => {
    const result = deriveState(facts({ projectStatus: "Done", run, pullRequest: pr() }));
    expect(result.state).toBe("Blocked");
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "PROJECT_STATUS_DRIFT" }));
  });

  it("blocks conflicting markers", () => {
    const result = deriveState(facts({ markerFinding: "MARKER_CONFLICT" }));
    expect(result.state).toBe("Blocked");
  });

  it("keeps a failed run Blocked when a Draft PR was already created", () => {
    const result = deriveState(facts({ projectStatus: "Blocked", run: { ...run, state: "failed" }, pullRequest: pr() }));
    expect(result.state).toBe("Blocked");
  });
});

function facts(overrides: { projectStatus?: string; approvedPlan?: ApprovedPlanMarker; run?: RunMarker; pullRequest?: WorkflowFacts["pullRequest"]; issueState?: "open" | "closed"; markerFinding?: "MARKER_CONFLICT" } = {}): WorkflowFacts {
  return {
    issue: { number: 42, title: "Test", state: overrides.issueState ?? "open", body: "", comments: [] },
    projectItem: { id: "item", status: overrides.projectStatus ?? "Backlog" },
    approvedPlan: overrides.approvedPlan ?? null,
    run: overrides.run ?? null,
    pullRequest: overrides.pullRequest ?? null,
    checks: overrides.pullRequest ? { state: "success", total: 1, failing: [] } : null,
    git: { currentBranch: overrides.run?.branch ?? null, localBranches: overrides.run ? [overrides.run.branch] : [], remoteBranches: [] },
    markerFindings: overrides.markerFinding ? [{ code: overrides.markerFinding, message: "conflict" }] : []
  };
}

function pr(overrides: Partial<NonNullable<WorkflowFacts["pullRequest"]>> = {}): NonNullable<WorkflowFacts["pullRequest"]> {
  return { number: 51, state: "open", draft: true, merged: false, headSha: "a".repeat(40), branch: "feat/42", url: "https://example.test/pr/51", ...overrides };
}
