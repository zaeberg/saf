import parseArgsStringToArgv from "string-argv";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export interface ValidationEvidence { command: string; exitCode: number; completedAt: string; }
export type BuildExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function checkBuildTools(root: string, execute: BuildExecutor = runCommand): Promise<CommandResult<void>> {
  const [ralphex, codex] = await Promise.all([
    execute({ command: "ralphex", args: ["--version"], cwd: root }),
    execute({ command: "codex", args: ["--version"], cwd: root })
  ]);
  if (!ralphex.ok) return failure([{ code: "TOOL_NOT_FOUND", severity: "error", message: "Ralphex is unavailable.", remediation: "Install a Ralphex version with native Codex mode." }]);
  if (!codex.ok) return failure([{ code: "TOOL_NOT_FOUND", severity: "error", message: "Codex CLI is unavailable.", remediation: "Install and authenticate Codex CLI." }]);
  const authentication = await execute({ command: "codex", args: ["login", "status"], cwd: root });
  if (!authentication.ok) return failure([{ code: "CODEX_AUTH_MISSING", severity: "error", message: "Codex CLI is not authenticated.", remediation: "Run codex login before saf build." }]);
  return success(undefined);
}

export async function runRalphex(root: string, planPath: string, branch: string, execute: BuildExecutor = runCommand): Promise<CommandResult<void>> {
  const result = await execute({ command: "ralphex", args: ["--codex", `--branch=${branch}`, planPath], cwd: root, stdio: "inherit" });
  if (result.ok) return success(undefined);
  if (result.diagnostics.some((diagnostic) => diagnostic.code === "COMMAND_CANCELLED")) return result;
  return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Ralphex execution failed.", remediation: "Inspect the preserved branch and rerun saf build for recovery." }]);
}

export async function runValidation(root: string, commands: string[], execute: BuildExecutor = runCommand): Promise<CommandResult<ValidationEvidence[]>> {
  const evidence: ValidationEvidence[] = [];
  for (const command of commands) {
    const argv = parseArgsStringToArgv(command);
    if (argv.length === 0) return failure([{ code: "CONFIG_INVALID", severity: "error", message: "Validation command is empty.", remediation: "Fix .saf/config.yaml validation commands." }]);
    const result = await execute({ command: argv[0]!, args: argv.slice(1), cwd: root, stdio: "inherit" });
    if (!result.ok) return result.diagnostics.some((diagnostic) => diagnostic.code === "COMMAND_CANCELLED")
      ? result
      : failure([{ code: "VALIDATION_FAILED", severity: "error", message: `Validation failed: ${command}`, remediation: "Fix validation failures and rerun saf build." }]);
    evidence.push({ command, exitCode: result.data.exitCode, completedAt: new Date().toISOString() });
  }
  return success(evidence);
}
