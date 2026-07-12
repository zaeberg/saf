import { z } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

const repositorySchema = z.object({ nameWithOwner: z.string(), hasIssuesEnabled: z.boolean(), defaultBranchRef: z.object({ name: z.string() }) });
export interface RepositoryDetails { repository: string; defaultBranch: string; }
export type PreflightExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function githubPreflight(repository: string, cwd: string, execute: PreflightExecutor = runCommand): Promise<CommandResult<RepositoryDetails>> {
  const auth = await execute({ command: "gh", args: ["auth", "status"], cwd });
  if (!auth.ok) return failure([{ code: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "TOOL_NOT_FOUND" : "GITHUB_AUTH_MISSING", severity: "error", message: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "Required tool gh was not found." : "GitHub CLI authentication is missing or invalid.", remediation: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "Install gh and retry." : "Run gh auth login and retry." }]);
  const response = await execute({ command: "gh", args: ["repo", "view", repository, "--json", "nameWithOwner,hasIssuesEnabled,defaultBranchRef"], cwd });
  if (!response.ok) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `Cannot access GitHub repository ${repository}.`, remediation: "Verify origin and gh repository access." }]);
  try {
    const parsed = repositorySchema.parse(JSON.parse(response.data.stdout));
    if (parsed.nameWithOwner.toLowerCase() !== repository.toLowerCase()) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `GitHub returned repository ${parsed.nameWithOwner} for ${repository}.`, remediation: "Check origin and GitHub access." }]);
    if (!parsed.hasIssuesEnabled) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `Issues are disabled for ${repository}.`, remediation: "Enable GitHub Issues before initializing SAF." }]);
    return success({ repository: parsed.nameWithOwner, defaultBranch: parsed.defaultBranchRef.name });
  } catch {
    return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unexpected gh repo view response.", remediation: "Update gh and retry with --verbose." }]);
  }
}
