import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export const requiredTools = ["claude", "ralphex", "codex"] as const;
type DiscoveryExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function checkRequiredTools(cwd: string, execute: DiscoveryExecutor = runCommand): Promise<CommandResult<Record<string, string>>> {
  const versions: Record<string, string> = {};
  const diagnostics = [];
  for (const tool of requiredTools) {
    const result = await execute({ command: tool, args: ["--version"], cwd });
    if (!result.ok) diagnostics.push({ code: "TOOL_NOT_FOUND" as const, severity: "error" as const, message: `Required tool ${tool} was not found or could not run.`, remediation: `Install ${tool} and ensure it is on PATH.` });
    else versions[tool] = (result.data.stdout || result.data.stderr).trim();
  }
  return diagnostics.length > 0 ? failure(diagnostics) : success(versions);
}

export async function discoverValidationCommands(root: string): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown>; packageManager?: string };
    const scripts = value.scripts ?? {};
    const manager = value.packageManager?.split("@")[0] ?? "npm";
    if (typeof scripts.check === "string") return [`${manager} check`];
    return ["lint", "typecheck", "test"].filter((name) => typeof scripts[name] === "string").map((name) => `${manager} ${name}`);
  } catch {
    return [];
  }
}
