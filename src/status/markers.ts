import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";

const markerPattern = /<!--\s*saf:marker:v(\d+):([A-Za-z0-9_-]+)\s*-->/g;

const approvedPlanSchema = z.object({
  version: z.literal(1),
  kind: z.literal("approved-plan"),
  issue: z.number().int().positive(),
  revision: z.number().int().positive(),
  normalizationVersion: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  plan: z.string().min(1),
  planPath: z.string().min(1).optional()
});
const runSchema = z.object({
  version: z.literal(1),
  kind: z.literal("run"),
  issue: z.number().int().positive(),
  runId: z.string().min(1),
  state: z.enum(["started", "succeeded", "failed", "cancelled"]),
  branch: z.string().min(1),
  pullRequest: z.number().int().positive().optional(),
  planRevision: z.number().int().positive().optional(),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  baseSha: z.string().min(7).optional(),
  failurePhase: z.string().min(1).optional(),
  completedAt: z.string().datetime().optional()
});
const acceptanceSchema = z.object({
  version: z.literal(1),
  kind: z.literal("human-acceptance"),
  issue: z.number().int().positive(),
  sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  acceptedAt: z.string().datetime()
});
const markerSchema = z.discriminatedUnion("kind", [approvedPlanSchema, runSchema, acceptanceSchema]);

export type SafMarker = z.infer<typeof markerSchema>;
export type ApprovedPlanMarker = z.infer<typeof approvedPlanSchema>;
export type RunMarker = z.infer<typeof runSchema>;
export type AcceptanceMarker = z.infer<typeof acceptanceSchema>;

export interface MarkerFinding {
  code: "MARKER_UNKNOWN_VERSION" | "MARKER_INVALID" | "MARKER_CONFLICT" | "PLAN_HASH_MISMATCH";
  message: string;
}

export interface ParsedMarkers {
  approvedPlan?: ApprovedPlanMarker;
  approvedPlanCommentId?: number;
  approvedPlanCommentIds?: number[];
  run?: RunMarker;
  runCommentId?: number;
  runCommentIds?: number[];
  acceptance?: AcceptanceMarker;
  acceptanceCommentId?: number;
  findings: MarkerFinding[];
}

export function parseMarkers(comments: Array<{ id: number; body: string; updatedAt?: string }>, issue: number): ParsedMarkers {
  const findings: MarkerFinding[] = [];
  const markers: Array<{ marker: SafMarker; commentId: number; updatedAt?: string }> = [];
  for (const comment of comments) {
    for (const match of comment.body.matchAll(markerPattern)) {
      const version = Number(match[1]);
      if (version !== 1) {
        findings.push({ code: "MARKER_UNKNOWN_VERSION", message: `Comment ${comment.id} uses unsupported marker version ${version}.` });
        continue;
      }
      try {
        const decoded = gunzipSync(Buffer.from(match[2]!, "base64url"), { maxOutputLength: 1_000_000 }).toString("utf8");
        const parsed = markerSchema.safeParse(JSON.parse(decoded));
        if (!parsed.success || parsed.data.version !== version || parsed.data.issue !== issue) {
          findings.push({ code: "MARKER_INVALID", message: `Comment ${comment.id} contains an invalid SAF marker.` });
          continue;
        }
        markers.push({ marker: parsed.data, commentId: comment.id, ...(comment.updatedAt ? { updatedAt: comment.updatedAt } : {}) });
      } catch {
        findings.push({ code: "MARKER_INVALID", message: `Comment ${comment.id} contains malformed marker JSON.` });
      }
    }
  }

  const approvedEntries = markers.filter((entry): entry is typeof entry & { marker: ApprovedPlanMarker } => entry.marker.kind === "approved-plan");
  const runEntries = markers.filter((entry): entry is typeof entry & { marker: RunMarker } => entry.marker.kind === "run");
  const approvedPlan = selectMarker(approvedEntries.map((entry) => entry.marker), "approved-plan", findings);
  const run = selectMarker(runEntries.map((entry) => entry.marker), "run", findings);
  const acceptanceEntry = markers
    .filter((entry): entry is typeof entry & { marker: AcceptanceMarker } => entry.marker.kind === "human-acceptance")
    .sort((left, right) => (left.updatedAt ?? "").localeCompare(right.updatedAt ?? "") || left.commentId - right.commentId)
    .at(-1);
  const acceptance = acceptanceEntry?.marker;
  if (approvedPlan && hashPlan(approvedPlan.plan) !== approvedPlan.sha256) findings.push({ code: "PLAN_HASH_MISMATCH", message: `Approved plan revision ${approvedPlan.revision} does not match its SHA-256.` });
  return {
    ...(approvedPlan ? {
      approvedPlan,
      approvedPlanCommentId: approvedEntries.find((entry) => JSON.stringify(entry.marker) === JSON.stringify(approvedPlan))!.commentId,
      approvedPlanCommentIds: approvedEntries.filter((entry) => JSON.stringify(entry.marker) === JSON.stringify(approvedPlan)).map((entry) => entry.commentId)
    } : {}),
    ...(run ? {
      run,
      runCommentId: runEntries.find((entry) => JSON.stringify(entry.marker) === JSON.stringify(run))!.commentId,
      runCommentIds: runEntries.filter((entry) => JSON.stringify(entry.marker) === JSON.stringify(run)).map((entry) => entry.commentId)
    } : {}),
    ...(acceptance && acceptanceEntry ? { acceptance, acceptanceCommentId: acceptanceEntry.commentId } : {}),
    findings
  };
}

export function normalizePlan(plan: string): string {
  const normalized = plan.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\t ]+$/g, "")).join("\n").replace(/\n*$/g, "");
  return `${normalized}\n`;
}

export function hashPlan(plan: string): string {
  return createHash("sha256").update(normalizePlan(plan), "utf8").digest("hex");
}

export function serializeMarker(marker: SafMarker): string {
  const payload = gzipSync(Buffer.from(JSON.stringify(marker), "utf8"), { level: 9 }).toString("base64url");
  const envelope = `<!-- saf:marker:v${marker.version}:${payload} -->`;
  return `${envelope}\n\n${renderMarkerSummary(marker)}`;
}

function renderMarkerSummary(marker: SafMarker): string {
  switch (marker.kind) {
    case "approved-plan":
      return [
        "**SAF · Approved plan**",
        "",
        `- Issue: #${marker.issue}`,
        `- Revision: r${marker.revision}`,
        `- SHA-256: \`${marker.sha256}\``,
        "",
        "<details>",
        `<summary>Full approved plan r${marker.revision}</summary>`,
        "",
        normalizePlan(marker.plan),
        "</details>"
      ].join("\n");
    case "run":
      return [
        "**SAF · Build run**",
        "",
        `- Issue: #${marker.issue}`,
        `- State: ${marker.state}`,
        `- Branch: \`${safeInline(marker.branch)}\``,
        `- Run: \`${safeInline(marker.runId)}\``,
        ...(marker.pullRequest ? [`- Pull Request: #${marker.pullRequest}`] : []),
        ...(marker.planRevision ? [`- Plan: r${marker.planRevision}${marker.planSha256 ? ` (\`${marker.planSha256}\`)` : ""}`] : []),
        ...(marker.failurePhase ? [`- Failed phase: ${safeInline(marker.failurePhase)}`] : [])
      ].join("\n");
    case "human-acceptance":
      return [
        "**SAF · Human acceptance**",
        "",
        `- Issue: #${marker.issue}`,
        `- Commit: \`${marker.sha}\``,
        `- Accepted at: ${marker.acceptedAt}`
      ].join("\n");
  }
}

function safeInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/`/g, "'");
}

function selectMarker<T extends SafMarker>(markers: T[], kind: string, findings: MarkerFinding[]): T | undefined {
  const unique = new Map(markers.map((marker) => [JSON.stringify(marker), marker]));
  if (unique.size > 1) {
    findings.push({ code: "MARKER_CONFLICT", message: `Conflicting ${kind} markers were found.` });
    return undefined;
  }
  return unique.values().next().value as T | undefined;
}
