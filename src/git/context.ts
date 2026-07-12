import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";
import { parseGitHubRemote } from "./remote.js";

export interface GitContext { root: string; repository: string; }
export type CommandExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function inspectGitContext(cwd: string, execute: CommandExecutor = runCommand): Promise<CommandResult<GitContext>> {
  const root = await execute({ command: "git", args: ["rev-parse", "--show-toplevel"], cwd });
  if (!root.ok) return failure([{ code: "GIT_REPOSITORY_NOT_FOUND", severity: "error", message: "Current directory is not inside a Git repository.", remediation: "Run saf init inside the target repository." }]);
  const repositoryRoot = root.data.stdout.trim();
  const remote = await execute({ command: "git", args: ["remote", "get-url", "origin"], cwd: repositoryRoot });
  if (!remote.ok) return failure([{ code: "GIT_REPOSITORY_NOT_FOUND", severity: "error", message: "Git remote origin is missing.", remediation: "Configure origin for the target GitHub repository." }]);
  const repository = parseGitHubRemote(remote.data.stdout);
  if (!repository.ok) return repository;
  return success({ root: repositoryRoot, repository: repository.data });
}
