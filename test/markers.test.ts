import { describe, expect, it } from "vitest";
import { hashPlan, normalizePlan, parseMarkers, serializeMarker, type AcceptanceMarker, type ApprovedPlanMarker, type RunMarker } from "../src/status/markers.js";

const plan = "# Plan\r\n\r\n```bash\r\npnpm test\r\n```\r\n\r\nTask 1   \r\n";
const approved: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: 42, revision: 1, normalizationVersion: 1, sha256: hashPlan(plan), plan };

describe("SAF markers", () => {
  it("round-trips an approved plan and verifies its hash", () => {
    const body = serializeMarker(approved);
    const parsed = parseMarkers([{ id: 1, body }], 42);
    expect(parsed.approvedPlan).toEqual(approved);
    expect(parsed.findings).toEqual([]);
    expect(body).toContain("**SAF · Approved plan**");
    expect(body).toContain("<summary>Full approved plan r1</summary>");
    expect(body).toContain(normalizePlan(plan));
  });

  it("accepts identical duplicate markers", () => {
    const body = serializeMarker(approved);
    expect(parseMarkers([{ id: 1, body }, { id: 2, body }], 42).findings).toEqual([]);
  });

  it("blocks conflicting markers", () => {
    const changed = { ...approved, revision: 2 };
    const parsed = parseMarkers([{ id: 1, body: serializeMarker(approved) }, { id: 2, body: serializeMarker(changed) }], 42);
    expect(parsed.approvedPlan).toBeUndefined();
    expect(parsed.findings).toContainEqual(expect.objectContaining({ code: "MARKER_CONFLICT" }));
  });

  it("reports unknown versions without treating them as valid", () => {
    const body = serializeMarker(approved).replace("saf:marker:v1", "saf:marker:v2");
    const parsed = parseMarkers([{ id: 1, body }], 42);
    expect(parsed.approvedPlan).toBeUndefined();
    expect(parsed.findings).toMatchObject([{ code: "MARKER_UNKNOWN_VERSION" }]);
  });

  it("rejects a damaged hidden envelope even when the visible summary remains readable", () => {
    const body = serializeMarker(approved).replace(/(saf:marker:v1:)[A-Za-z0-9_-]+/, "$1damaged");
    const parsed = parseMarkers([{ id: 1, body }], 42);
    expect(body).toContain("**SAF · Approved plan**");
    expect(parsed.approvedPlan).toBeUndefined();
    expect(parsed.findings).toContainEqual(expect.objectContaining({ code: "MARKER_INVALID" }));
  });

  it("detects plan hash drift", () => {
    const marker = { ...approved, plan: `${approved.plan}changed` };
    expect(parseMarkers([{ id: 1, body: serializeMarker(marker) }], 42).findings).toContainEqual(expect.objectContaining({ code: "PLAN_HASH_MISMATCH" }));
  });

  it("treats acceptance markers as SHA history and selects the latest", () => {
    const old: AcceptanceMarker = { version: 1, kind: "human-acceptance", issue: 42, sha: "a".repeat(40), acceptedAt: "2026-07-12T00:00:00.000Z" };
    const current: AcceptanceMarker = { ...old, sha: "b".repeat(40), acceptedAt: "2026-07-12T01:00:00.000Z" };
    const parsed = parseMarkers([
      { id: 1, body: serializeMarker(old), updatedAt: "2026-07-12T00:00:00Z" },
      { id: 2, body: serializeMarker(current), updatedAt: "2026-07-12T01:00:00Z" }
    ], 42);
    expect(parsed.acceptance).toEqual(current);
    expect(parsed.findings).toEqual([]);
  });

  it("renders visible summaries for run and acceptance markers", () => {
    const run: RunMarker = { version: 1, kind: "run", issue: 42, runId: "run-1", state: "started", branch: "feat/42", pullRequest: 51 };
    const acceptance: AcceptanceMarker = { version: 1, kind: "human-acceptance", issue: 42, sha: "a".repeat(40), acceptedAt: "2026-07-12T01:00:00.000Z" };
    const runBody = serializeMarker(run);
    const acceptanceBody = serializeMarker(acceptance);
    expect(runBody).toContain("**SAF · Build run**");
    expect(runBody).toContain("- Branch: `feat/42`");
    expect(runBody).toContain("- Pull Request: #51");
    expect(acceptanceBody).toContain("**SAF · Human acceptance**");
    expect(acceptanceBody).toContain(`- Commit: \`${acceptance.sha}\``);
    expect(parseMarkers([{ id: 1, body: runBody }, { id: 2, body: acceptanceBody }], 42)).toMatchObject({ run, acceptance, findings: [] });
  });

  it.each([
    ["line one\r\nline two   \r\n", "line one\nline two\n"],
    ["line one\nline two\n\n\n", "line one\nline two\n"],
    ["line one\rline two\t", "line one\nline two\n"]
  ])("normalizes plan bytes deterministically", (input, expected) => {
    expect(normalizePlan(input)).toBe(expected);
    expect(hashPlan(input)).toBe(hashPlan(expected));
  });
});
