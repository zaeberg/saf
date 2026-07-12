import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter } from "../github/types.js";
import { runCommand } from "../runner/command-runner.js";
import { readWorkflowFacts } from "./reader.js";
import { deriveState } from "./reducer.js";
import { createStatusReport, type StatusReport } from "./report.js";

export interface StatusDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
}
const defaults: StatusDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter };

export async function getStatus(issue: number, cwd: string, dependencies: StatusDependencies = defaults): Promise<CommandResult<StatusReport>> {
  if (!Number.isInteger(issue) || issue <= 0) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid Issue number: ${issue}`, remediation: "Pass a positive GitHub Issue number." }]);
  const git = await inspectGitContext(cwd, dependencies.execute);
  if (!git.ok) return git;
  const config = await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (!config.ok) return config;
  if (config.data.github.repository.toLowerCase() !== git.data.repository.toLowerCase()) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Config repository ${config.data.github.repository} differs from origin ${git.data.repository}.`, remediation: "Restore the configured origin before reading workflow status." }]);
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const facts = await readWorkflowFacts(config.data, issue, git.data.root, github.data, dependencies.execute);
  if (!facts.ok) return facts;
  return success(createStatusReport(facts.data, deriveState(facts.data)));
}
