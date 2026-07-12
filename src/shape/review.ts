import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export type ReviewExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function reviewPlan(root: string, planPath: string, annotationsPath: string, execute: ReviewExecutor = runCommand): Promise<CommandResult<{ annotations: boolean }>> {
  const displayPath = relative(root, planPath) || planPath;
  const runtimeDirectory = dirname(annotationsPath);
  const emptyBaselinePath = join(runtimeDirectory, "empty-plan.md");
  try {
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(emptyBaselinePath, "", "utf8");
  } catch {
    return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to prepare the temporary plan review baseline.", remediation: "Check .saf/runtime permissions and rerun saf shape." }]);
  }
  const result = await execute({ command: "revdiff", args: [`--compare-old=${emptyBaselinePath}`, `--compare-new=${planPath}`, `--output=${annotationsPath}`, "--exit-code-on-annotations", `--description=SAF plan review: ${displayPath}`], cwd: root, stdio: "inherit", acceptedExitCodes: [0, 10] });
  if (!result.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "revdiff plan review failed.", remediation: "Resolve revdiff availability and rerun saf shape." }]);
  return success({ annotations: result.data.exitCode === 10 });
}
