import { describe, expect, it } from "vitest";
import { success } from "../src/contracts/result.js";
import { renderResult } from "../src/output.js";
import { renderHumanStatus, type StatusReport } from "../src/status/report.js";

const report: StatusReport = {
  issue: { number: 42, title: "Test issue", state: "open" },
  projectStatus: "Review",
  derivedState: "Review",
  plan: { revision: 2, sha256: "a".repeat(64), valid: true },
  branch: "feat/42",
  pullRequest: { number: 51, state: "open", draft: true, merged: false, headSha: "b".repeat(40), url: "https://example.test/pr/51" },
  ci: "success",
  humanAcceptance: { presentForCurrentSha: false, evidenceSha: null },
  findings: [],
  blockers: [],
  nextAction: "saf review 42"
};

describe("status rendering", () => {
  it("keeps a stable JSON shape", () => {
    expect(JSON.parse(renderResult(success(report), "json"))).toEqual({ ok: true, data: report, diagnostics: [] });
  });

  it("shows Project and derived state separately", () => {
    const output = renderHumanStatus(success(report));
    expect(output).toContain("Project status: Review");
    expect(output).toContain("Derived state: Review");
    expect(output).toContain("Next action: saf review 42");
  });
});
