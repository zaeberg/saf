import type { CommandResult } from "../contracts/result.js";
import type { WorkflowFacts } from "./facts.js";
import type { StateDerivation } from "./facts.js";

export interface StatusReport {
  issue: { number: number; title: string; state: string };
  projectStatus: string | null;
  derivedState: string;
  plan: { revision: number; sha256: string; valid: boolean } | null;
  branch: string | null;
  pullRequest: { number: number; state: string; draft: boolean; merged: boolean; headSha: string; url: string } | null;
  ci: string | null;
  findings: StateDerivation["findings"];
  blockers: StateDerivation["blockers"];
  nextAction: string;
}

export function createStatusReport(facts: WorkflowFacts, derivation: StateDerivation): StatusReport {
  return {
    issue: { number: facts.issue.number, title: facts.issue.title, state: facts.issue.state },
    projectStatus: facts.projectItem.status,
    derivedState: derivation.state,
    plan: facts.approvedPlan ? { revision: facts.approvedPlan.revision, sha256: facts.approvedPlan.sha256, valid: !facts.markerFindings.some((finding) => finding.code === "PLAN_HASH_MISMATCH") } : null,
    branch: facts.run?.branch ?? facts.pullRequest?.branch ?? null,
    pullRequest: facts.pullRequest ? { number: facts.pullRequest.number, state: facts.pullRequest.state, draft: facts.pullRequest.draft, merged: facts.pullRequest.merged, headSha: facts.pullRequest.headSha, url: facts.pullRequest.url } : null,
    ci: facts.checks?.state ?? null,
    findings: derivation.findings,
    blockers: derivation.blockers,
    nextAction: derivation.nextAction
  };
}

export function renderHumanStatus(result: CommandResult<StatusReport>): string {
  if (!result.ok) return result.diagnostics.map((diagnostic) => `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}\n  Remedy: ${diagnostic.remediation}`).join("\n");
  const report = result.data;
  const lines = [
    `Issue: #${report.issue.number} — ${report.issue.title}`,
    `Project status: ${report.projectStatus ?? "missing"}`,
    `Derived state: ${report.derivedState}`,
    `Plan: ${report.plan ? `r${report.plan.revision}, ${report.plan.valid ? "valid" : "invalid"}, ${report.plan.sha256}` : "missing"}`,
    `Branch: ${report.branch ?? "missing"}`,
    `Pull Request: ${report.pullRequest ? `#${report.pullRequest.number}, ${report.pullRequest.merged ? "merged" : report.pullRequest.state}${report.pullRequest.draft ? ", Draft" : ""}` : "missing"}`,
    `CI: ${report.ci ?? "unknown"}`
  ];
  for (const finding of report.findings) lines.push(`Finding [${finding.code}]: ${finding.message}`);
  lines.push(`Next action: ${report.nextAction}`);
  return lines.join("\n");
}
