import type { DerivedState, DriftFinding, StateDerivation, WorkflowFacts } from "./facts.js";

const expectedProjectStatus: Partial<Record<DerivedState, string>> = {
  Inbox: "Backlog",
  Shaping: "Shaping",
  Ready: "Ready",
  Running: "Running",
  Review: "Review",
  Blocked: "Blocked",
  Done: "Done"
};

export function deriveState(facts: WorkflowFacts): StateDerivation {
  const findings: DriftFinding[] = facts.markerFindings.map((finding) => ({ ...finding, severity: "error" }));
  let state = derivePrimaryState(facts, findings);

  if (!facts.pullRequest?.merged && facts.run && !facts.git.localBranches.includes(facts.run.branch) && !facts.git.remoteBranches.includes(facts.run.branch)) {
    findings.push({ code: "BRANCH_DRIFT", severity: "error", message: `Run branch ${facts.run.branch} does not exist locally or in known remote refs.` });
    state = "Blocked";
  }
  if (!facts.pullRequest?.merged && facts.pullRequest && facts.run?.branch !== facts.pullRequest.branch) {
    findings.push({ code: "BRANCH_DRIFT", severity: "error", message: `Run branch ${facts.run?.branch ?? "missing"} differs from Pull Request branch ${facts.pullRequest.branch}.` });
    state = "Blocked";
  }
  if (facts.run?.pullRequest && !facts.pullRequest) {
    findings.push({ code: "PULL_REQUEST_DRIFT", severity: "error", message: `Run references missing Pull Request #${facts.run.pullRequest}.` });
    state = "Blocked";
  }
  if (!facts.pullRequest?.merged && facts.checks?.state === "failure") {
    findings.push({ code: "CI_FAILED", severity: "error", message: `CI failed: ${facts.checks.failing.join(", ") || "unknown check"}.` });
    state = "Blocked";
  }
  if (facts.acceptance?.evidence && facts.pullRequest && facts.acceptance.evidence.sha !== facts.pullRequest.headSha) {
    findings.push({ code: "STALE_ACCEPTANCE", severity: "warning", message: `Human acceptance targets ${facts.acceptance.evidence.sha}, not current SHA ${facts.pullRequest.headSha}.` });
  }
  if (facts.projectItem.status === "Done" && !facts.pullRequest?.merged) {
    findings.push({ code: "PROJECT_STATUS_DRIFT", severity: "error", message: "Project Status is Done but the Pull Request is not merged." });
    state = "Blocked";
  }

  const expected = expectedProjectStatus[state];
  if (expected && facts.projectItem.status !== expected && !findings.some((finding) => finding.code === "PROJECT_STATUS_DRIFT")) {
    findings.push({ code: "PROJECT_STATUS_DRIFT", severity: "warning", message: `Project Status ${facts.projectItem.status ?? "missing"} differs from derived state ${state}.` });
  }
  const blockers = findings.filter((finding) => finding.severity === "error");
  return { state, findings, blockers, nextAction: nextAction(state, facts) };
}

function derivePrimaryState(facts: WorkflowFacts, findings: DriftFinding[]): DerivedState {
  if (findings.length > 0) return "Blocked";
  if (facts.pullRequest?.merged) return "Done";
  if (facts.issue.state === "closed" && !facts.pullRequest) return "Cancelled";
  if (facts.pullRequest?.state === "closed") return "Blocked";
  if (facts.run?.state === "failed") return "Blocked";
  if (facts.run?.state === "cancelled") return "Cancelled";
  if (facts.pullRequest) return "Review";
  if (facts.run) return "Running";
  if (facts.approvedPlan) return "Ready";
  if (facts.projectItem.status === "Shaping") return "Shaping";
  return "Inbox";
}

function nextAction(state: DerivedState, facts: WorkflowFacts): string {
  switch (state) {
    case "Inbox": return `saf shape ${facts.issue.number}`;
    case "Shaping": return `saf shape ${facts.issue.number}`;
    case "Ready": return `saf build ${facts.issue.number}`;
    case "Running": return `saf status ${facts.issue.number}`;
    case "Review": return facts.acceptance?.statusForCurrentSha ? "manual merge" : `saf review ${facts.issue.number}`;
    case "Blocked": return "resolve blockers, then rerun saf status";
    case "Done": return "manual cleanup";
    case "Cancelled": return "no action";
  }
}
