import { readFile } from "node:fs/promises";
import { failure, success, type CommandResult } from "../contracts/result.js";

export interface PlanArtifact {
  path: string;
  content: string;
}

const requiredSections = [
  { name: "Overview", pattern: /^(#{1,6})\s+(Overview|Goal|Цель)\s*$/im },
  { name: "Implementation Steps", pattern: /^(#{1,6})\s+(Implementation Steps|Tasks|Задачи)\s*$/im },
  { name: "Solution Overview", pattern: /^(#{1,6})\s+(Solution Overview|Acceptance criteria|Критерии при[её]мки)\s*$/im },
  { name: "Validation Commands", pattern: /^(#{1,6})\s+(Validation Commands|Validation|Проверка)\s*$/im }
] as const;

export async function loadAndLintPlan(path: string): Promise<CommandResult<PlanArtifact>> {
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch { return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: `Plan file not found: ${path}`, remediation: "Pass an existing plan with --plan or rerun the planner." }]); }

  const problems: string[] = [];
  for (const section of requiredSections) if (!section.pattern.test(content)) problems.push(`missing section ${section.name}`);
  const tasks = sectionBody(content, requiredSections[1].pattern);
  const validation = sectionBody(content, requiredSections[3].pattern);
  if (tasks !== null && !/^\s*[-*]\s+\S+/m.test(tasks)) problems.push("Tasks has no actionable list items");
  if (validation !== null && !/(?:```[\s\S]*?\S[\s\S]*?```|^\s*[-*]\s+\S+)/m.test(validation)) problems.push("Validation has no commands");
  if (/\b(?:TODO|TBD|FIXME)\b|\?\?\?|<placeholder>/i.test(content)) problems.push("unresolved placeholders");
  if (content.trim().length < 120) problems.push("plan is too short to be executable");
  if (problems.length > 0) return failure(problems.map((problem) => ({ code: "PLAN_INVALID" as const, severity: "error" as const, message: `Invalid plan: ${problem}.`, remediation: "Revise the plan and rerun saf shape." })));
  return success({ path, content });
}

function sectionBody(content: string, heading: RegExp): string | null {
  const match = heading.exec(content);
  if (!match) return null;
  return content.slice(match.index + match[0].length).split(/\n(?=#{1,6}\s)/, 1)[0] ?? "";
}
