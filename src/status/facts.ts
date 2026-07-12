import type { CheckDetails, IssueDetails, ProjectItemDetails, PullRequestDetails } from "../github/types.js";
import type { ApprovedPlanMarker, MarkerFinding, RunMarker } from "./markers.js";

export interface GitFacts {
  currentBranch: string | null;
  localBranches: string[];
  remoteBranches: string[];
}

export interface WorkflowFacts {
  issue: IssueDetails;
  projectItem: ProjectItemDetails;
  approvedPlan: ApprovedPlanMarker | null;
  run: RunMarker | null;
  pullRequest: PullRequestDetails | null;
  checks: CheckDetails | null;
  git: GitFacts;
  markerFindings: MarkerFinding[];
}

export type DerivedState = "Inbox" | "Shaping" | "Ready" | "Running" | "Review" | "Blocked" | "Done" | "Cancelled";

export interface DriftFinding {
  code: "MARKER_UNKNOWN_VERSION" | "MARKER_INVALID" | "MARKER_CONFLICT" | "PLAN_HASH_MISMATCH" | "PROJECT_STATUS_DRIFT" | "BRANCH_DRIFT" | "PULL_REQUEST_DRIFT" | "CI_FAILED";
  severity: "warning" | "error";
  message: string;
}

export interface StateDerivation {
  state: DerivedState;
  findings: DriftFinding[];
  blockers: DriftFinding[];
  nextAction: string;
}
