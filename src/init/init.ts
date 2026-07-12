import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import type { SafConfigV1 } from "../config/schema.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter } from "../github/types.js";
import { runCommand } from "../runner/command-runner.js";
import { checkRequiredTools, discoverValidationCommands } from "./discovery.js";
import { writeInitialization } from "./filesystem.js";
import { parseProjectReference } from "./project-reference.js";

export interface InitOptions { project: string; validationCommands: string[]; rebind: boolean; dryRun: boolean; yes: boolean; interactive: boolean; cwd: string; }
export interface InitSummary { repository: string; project: string; defaultBranch: string; validationCommands: string[]; changed: boolean; dryRun: boolean; }
export interface InitDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
  confirm: (message: string) => Promise<boolean>;
  write: typeof writeInitialization;
}
const defaults: InitDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter, confirm: async () => false, write: writeInitialization };

export async function initializeRepository(options: InitOptions, dependencies: InitDependencies = defaults): Promise<CommandResult<InitSummary>> {
  const reference = parseProjectReference(options.project);
  if (!reference.ok) return reference;
  const requestedBinding = `${reference.data.owner}/${reference.data.number}`;
  const git = await inspectGitContext(options.cwd, dependencies.execute);
  if (!git.ok) return git;
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const repository = await github.data.getRepository(git.data.repository);
  if (!repository.ok) return repository;
  const project = await github.data.getProject(reference.data, repository.data.repository);
  if (!project.ok) return project;
  const tools = await checkRequiredTools(git.data.root, dependencies.execute);
  if (!tools.ok) return tools;

  const existing = await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (existing.ok) {
    if (existing.data.github.repository.toLowerCase() !== repository.data.repository.toLowerCase()) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Config repository ${existing.data.github.repository} does not match origin ${repository.data.repository}.`, remediation: "Restore the correct origin or remove the stale SAF config and initialize again." }]);
    if (existing.data.repository.defaultBranch !== repository.data.defaultBranch) return failure([{ code: "CONFIG_INVALID", severity: "error", message: `Configured default branch ${existing.data.repository.defaultBranch} differs from GitHub default ${repository.data.defaultBranch}.`, remediation: "Review the repository default branch and update the SAF config explicitly." }]);
    const oldBinding = `${existing.data.github.project.owner}/${existing.data.github.project.number}`;
    if (oldBinding.toLowerCase() !== requestedBinding.toLowerCase() && !options.rebind) return failure([{ code: "REBIND_REQUIRED", severity: "error", message: `Repository is already bound to ${oldBinding}.`, remediation: `Use --rebind to change the binding to ${requestedBinding}.` }]);
    if (oldBinding.toLowerCase() === requestedBinding.toLowerCase()) return success(summary(repository.data.repository, oldBinding, repository.data.defaultBranch, existing.data.validation.commands, false, options.dryRun));
    if (!options.yes && !await dependencies.confirm(`Rebind ${oldBinding} to ${requestedBinding}?`)) return failure([{ code: "CONFIRMATION_REQUIRED", severity: "error", message: "Project rebind was not confirmed.", remediation: "Confirm interactively or pass --yes after reviewing the binding." }]);
  } else if (existing.diagnostics.some((diagnostic) => diagnostic.code !== "CONFIG_NOT_FOUND")) {
    return existing;
  }

  const discovered = await discoverValidationCommands(git.data.root);
  if (options.validationCommands.length === 0 && !options.interactive && !options.dryRun) return failure([{ code: "VALIDATION_COMMANDS_REQUIRED", severity: "error", message: "Non-interactive init requires explicit validation commands.", remediation: "Pass one or more --validation <command> options." }]);
  const validationCommands = options.validationCommands.length > 0 ? options.validationCommands : discovered;
  if (validationCommands.length === 0) return failure([{ code: "VALIDATION_COMMANDS_REQUIRED", severity: "error", message: "No validation commands were provided or discovered.", remediation: "Pass one or more --validation <command> options." }]);
  if (!options.dryRun && !options.yes && !await dependencies.confirm(`Use validation commands: ${validationCommands.join(", ")}?`)) return failure([{ code: "CONFIRMATION_REQUIRED", severity: "error", message: "Validation commands were not confirmed.", remediation: "Confirm interactively or pass explicit --validation options with --yes." }]);

  const config = createConfig(repository.data.repository, reference.data.owner, reference.data.number, repository.data.defaultBranch, validationCommands);
  if (!options.dryRun) {
    try { await dependencies.write(git.data.root, config); }
    catch (error: unknown) { return failure([{ code: "COMMAND_FAILED", severity: "error", message: error instanceof Error ? error.message : "Failed to initialize SAF files.", remediation: "Check repository filesystem permissions and retry." }]); }
  }
  const reloaded = options.dryRun ? success(config) : await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (!reloaded.ok) return reloaded;
  return success(summary(repository.data.repository, requestedBinding, repository.data.defaultBranch, validationCommands, true, options.dryRun));
}

function createConfig(repository: string, owner: string, number: number, defaultBranch: string, commands: string[]): SafConfigV1 {
  return { version: 1, github: { repository, project: { owner, number } }, repository: { defaultBranch }, documentation: { plansDirectory: "docs/plans" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1, tasksOnly: false }, review: { adapter: "ralphex-codex", externalReviewTool: "none" }, validation: { commands } };
}

function summary(repository: string, project: string, defaultBranch: string, validationCommands: string[], changed: boolean, dryRun: boolean): InitSummary {
  return { repository, project, defaultBranch, validationCommands, changed, dryRun };
}
