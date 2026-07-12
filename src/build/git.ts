import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

type GitExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function checkWorkspace(root: string, allowedPath: string | undefined, execute: GitExecutor = runCommand): Promise<CommandResult<void>> {
  const status = await execute({ command: "git", args: ["status", "--porcelain", "--untracked-files=all"], cwd: root });
  if (!status.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to inspect Git workspace.", remediation: "Check the repository and retry." }]);
  const dirty = status.data.stdout.split("\n").filter(Boolean).filter((line) => !allowedPath || !line.slice(3).replace(/^"|"$/g, "").endsWith(allowedPath));
  return dirty.length === 0 ? success(undefined) : failure([{ code: "WORKSPACE_DIRTY", severity: "error", message: `Workspace has unrelated changes: ${dirty.join(", ")}.`, remediation: "Commit, stash or remove unrelated changes before build." }]);
}

export async function gitValue(root: string, args: string[], execute: GitExecutor = runCommand): Promise<CommandResult<string>> {
  const result = await execute({ command: "git", args, cwd: root });
  return result.ok ? success(result.data.stdout.trim()) : failure([{ code: "COMMAND_FAILED", severity: "error", message: `Git command failed: git ${args.join(" ")}.`, remediation: "Inspect the repository and retry." }]);
}

export async function pushBranch(root: string, branch: string, execute: GitExecutor = runCommand): Promise<CommandResult<void>> {
  const result = await execute({ command: "git", args: ["push", "--set-upstream", "origin", branch], cwd: root, stdio: "inherit" });
  return result.ok ? success(undefined) : failure([{ code: "COMMAND_FAILED", severity: "error", message: `Failed to push branch ${branch}.`, remediation: "Resolve Git authentication/network issues and rerun saf build." }]);
}

export async function ensureRunBranch(root: string, branch: string, localBranches: string[], remoteBranches: string[], execute: GitExecutor = runCommand): Promise<CommandResult<void>> {
  const current = await gitValue(root, ["branch", "--show-current"], execute);
  if (!current.ok) return current;
  if (current.data === branch) return success(undefined);
  if (localBranches.includes(branch)) return switchBranch(root, ["switch", branch], branch, execute);
  if (remoteBranches.includes(branch)) {
    const fetched = await execute({ command: "git", args: ["fetch", "origin"], cwd: root, stdio: "inherit" });
    if (!fetched.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: `Unable to fetch recovery branch ${branch}.`, remediation: "Restore Git remote access and rerun saf build." }]);
    return switchBranch(root, ["switch", "--track", "-c", branch, `origin/${branch}`], branch, execute);
  }
  return failure([{ code: "BRANCH_INVALID", severity: "error", message: `Run branch ${branch} does not exist locally or on origin.`, remediation: "Restore the run branch or rerun the failed execution phase." }]);
}

async function switchBranch(root: string, args: string[], branch: string, execute: GitExecutor): Promise<CommandResult<void>> {
  const switched = await execute({ command: "git", args, cwd: root, stdio: "inherit" });
  return switched.ok ? success(undefined) : failure([{ code: "COMMAND_FAILED", severity: "error", message: `Unable to check out recovery branch ${branch}.`, remediation: "Resolve local workspace conflicts and rerun saf build." }]);
}
