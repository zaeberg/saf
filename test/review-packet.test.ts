import { describe, expect, it } from "vitest";
import { createReviewPacket, renderReviewPacket, reviewPacketSchemaV1 } from "../src/review/packet.js";
import type { WorkflowFacts } from "../src/status/facts.js";
import { hashPlan } from "../src/status/markers.js";

describe("review packet v1", () => {
  it("collects outcome, plan criteria, files and build evidence", () => {
    const plan = "# Plan\n\n## Acceptance criteria\n\n- CLI works\n- No merge\n";
    const facts: WorkflowFacts = {
      issue: { number: 42, title: "Review", state: "open", body: "Deliver safely", comments: [] },
      projectItem: { id: "item", status: "Review" },
      approvedPlan: { version: 1, kind: "approved-plan", issue: 42, revision: 2, normalizationVersion: 1, sha256: hashPlan(plan), plan },
      run: null,
      pullRequest: { number: 7, title: "Review", body: "- Validation:\n  - `pnpm check`: exit 0\n\n## Deviations\n\n- None\n\n## Limitations\n\n- Manual smoke remains\n", state: "open", draft: true, merged: false, headSha: "a".repeat(40), branch: "saf/42", url: "https://example.test/7", comments: [], changedFiles: ["src/review.ts"] },
      checks: { state: "success", total: 1, failing: [] }, acceptance: null,
      git: { currentBranch: "saf/42", localBranches: ["saf/42"], remoteBranches: ["saf/42"] }, markerFindings: []
    };
    const packet = createReviewPacket(facts);
    expect(reviewPacketSchemaV1.safeParse(packet).success).toBe(true);
    expect(packet).toMatchObject({ version: 1, issue: { outcome: "Deliver safely" }, approvedPlan: { revision: 2 }, acceptanceCriteria: ["CLI works", "No merge"], changedFiles: ["src/review.ts"], validation: ["`pnpm check`: exit 0"], deviations: ["None"], limitations: ["Manual smoke remains"] });
    expect(renderReviewPacket(packet)).toContain("<!-- saf:review-packet:v1 -->");
    expect(renderReviewPacket(packet)).toContain("## Acceptance criteria\n\n- CLI works");
  });
});
