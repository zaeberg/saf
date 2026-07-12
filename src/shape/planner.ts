import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { IssueDetails } from "../github/types.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export type PlannerExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function runPlanner(root: string, plansDirectory: string, issue: IssueDetails, execute: PlannerExecutor = runCommand): Promise<CommandResult<string>> {
  const directory = join(root, plansDirectory);
  const before = await planSnapshot(directory);
  const prompt = [
    `Shape GitHub Issue #${issue.number}.`,
    `Title: ${issue.title}`,
    "",
    issue.body || "(empty Issue body)",
    "",
    "Before brainstorming, read AGENTS.md and strongly follow instruction from it. Use its links to any documentation relevant to this Issue. Discover any other repository context yourself; do not assume the Issue contains enough architectural context.",
    "Keep the session interactive. Use /brainstorm:brainstorm when clarification is needed, then /planning:make.",
    `Save the final executable plan under ${plansDirectory}. Do not implement the plan.`
  ].join("\n");
  const result = await execute({ command: "claude", args: [prompt], cwd: root, stdio: "inherit" });
  if (!result.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Claude Code planning session failed or was cancelled.", remediation: "Resolve planner availability and rerun saf shape." }]);
  const after = await planSnapshot(directory);
  const changed = [...after.entries()].filter(([path, signature]) => before.get(path) !== signature).map(([path]) => path);
  if (changed.length === 0) return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: `Planner did not create or update a plan in ${plansDirectory}.`, remediation: "Complete /planning:make and ensure it writes one plan file." }]);
  if (changed.length > 1) return failure([{ code: "PLAN_AMBIGUOUS", severity: "error", message: `Planner changed multiple plan files: ${changed.map((path) => relative(root, path)).join(", ")}.`, remediation: "Rerun with --plan <path> to select the intended plan." }]);
  return success(changed[0]!);
}

export async function revisePlan(root: string, planPath: string, annotationsPath: string, execute: PlannerExecutor = runCommand): Promise<CommandResult<void>> {
  let before: string;
  try { before = await readFile(planPath, "utf8"); }
  catch { return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: `Plan file not found: ${planPath}`, remediation: "Restore the plan and rerun saf shape." }]); }
  const prompt = `Revise the plan at ${relative(root, planPath)} to resolve every revdiff annotation in ${relative(root, annotationsPath)}. Keep the session interactive, preserve the required plan sections, and do not implement the plan.`;
  const result = await execute({ command: "claude", args: [prompt], cwd: root, stdio: "inherit" });
  if (!result.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Claude Code plan revision failed or was cancelled.", remediation: "Resolve planner availability and rerun saf shape." }]);
  let after: string;
  try { after = await readFile(planPath, "utf8"); }
  catch { return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: `Planner removed the plan file: ${planPath}`, remediation: "Restore the plan and rerun saf shape." }]); }
  if (after === before) return failure([{ code: "PLAN_REVIEW_REQUIRED", severity: "error", message: "Planner returned without revising the annotated plan.", remediation: "Resolve all annotations before approval." }]);
  return success(undefined);
}

async function planSnapshot(directory: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of await markdownFiles(directory)) {
    const metadata = await stat(path);
    result.set(path, `${metadata.mtimeMs}:${metadata.size}`);
  }
  return result;
}

async function markdownFiles(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  }));
  return nested.flat();
}
