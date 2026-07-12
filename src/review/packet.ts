import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { WorkflowFacts } from "../status/facts.js";

export const reviewPacketSchemaV1 = z.strictObject({
  version: z.literal(1),
  issue: z.strictObject({ number: z.number().int().positive(), title: z.string(), outcome: z.string() }),
  pullRequest: z.strictObject({ number: z.number().int().positive(), url: z.string(), headSha: z.string(), branch: z.string() }),
  approvedPlan: z.strictObject({ revision: z.number().int().positive(), sha256: z.string() }),
  acceptanceCriteria: z.array(z.string()),
  changedFiles: z.array(z.string()),
  validation: z.array(z.string()),
  manualChecks: z.array(z.string()),
  deviations: z.array(z.string()),
  limitations: z.array(z.string())
});

export type ReviewPacketV1 = z.infer<typeof reviewPacketSchemaV1>;

export function createReviewPacket(facts: WorkflowFacts): ReviewPacketV1 {
  const plan = facts.approvedPlan!;
  const pullRequest = facts.pullRequest!;
  const criteria = sectionList(plan.plan, /Acceptance criteria|Критерии при[её]мки/i);
  return {
    version: 1,
    issue: { number: facts.issue.number, title: facts.issue.title, outcome: facts.issue.body },
    pullRequest: { number: pullRequest.number, url: pullRequest.url, headSha: pullRequest.headSha, branch: pullRequest.branch },
    approvedPlan: { revision: plan.revision, sha256: plan.sha256 },
    acceptanceCriteria: criteria,
    changedFiles: pullRequest.changedFiles ?? [],
    validation: evidenceLines(pullRequest.body ?? "", "Validation"),
    manualChecks: criteria,
    deviations: sectionList(pullRequest.body ?? "", /Deviations|Отклонения/i),
    limitations: sectionList(pullRequest.body ?? "", /Limitations|Ограничения/i)
  };
}

export async function writeReviewPacket(path: string, packet: ReviewPacketV1): Promise<void> {
  const valid = reviewPacketSchemaV1.parse(packet);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderReviewPacket(valid), "utf8");
}

export function renderReviewPacket(packet: ReviewPacketV1): string {
  return [
    "<!-- saf:review-packet:v1 -->",
    `# SAF review packet · Issue #${packet.issue.number}`,
    "",
    `- Issue: ${packet.issue.title}`,
    `- Pull Request: #${packet.pullRequest.number} (${packet.pullRequest.url})`,
    `- Head SHA: \`${packet.pullRequest.headSha}\``,
    `- Branch: \`${packet.pullRequest.branch}\``,
    `- Approved plan: r${packet.approvedPlan.revision} (\`${packet.approvedPlan.sha256}\`)`,
    "",
    "## Outcome",
    "", packet.issue.outcome || "(not specified)", "",
    ...renderList("Acceptance criteria", packet.acceptanceCriteria),
    ...renderList("Changed files", packet.changedFiles.map((file) => `\`${file}\``)),
    ...renderList("Validation evidence", packet.validation),
    ...renderList("Manual checks", packet.manualChecks),
    ...renderList("Deviations", packet.deviations),
    ...renderList("Limitations", packet.limitations)
  ].join("\n");
}

function renderList(title: string, values: string[]): string[] {
  return [`## ${title}`, "", ...(values.length > 0 ? values.map((value) => `- ${value}`) : ["- None reported"]), ""];
}

function sectionList(markdown: string, heading: RegExp): string[] {
  const match = new RegExp(`^#{1,6}\\s+(?:${heading.source})\\s*$`, "im").exec(markdown);
  if (!match) return [];
  const body = markdown.slice(match.index + match[0].length).split(/\n(?=#{1,6}\s)/, 1)[0] ?? "";
  return [...body.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((item) => item[1]!.trim());
}

function evidenceLines(markdown: string, label: string): string[] {
  const match = new RegExp(`^\\s*-\\s+${label}:\\s*$`, "im").exec(markdown);
  if (!match) return [];
  const body = markdown.slice(match.index + match[0].length).split(/\n(?=\S)/, 1)[0] ?? "";
  return [...body.matchAll(/^\s+-\s+(.+)$/gm)].map((item) => item[1]!.trim());
}
