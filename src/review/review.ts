import { join, resolve } from "node:path";
import { checkBuildTools, runRalphexReview, runValidation, type RalphexReviewOptions } from "../build/execution.js";
import { ensureRunBranch, pushBranch } from "../build/git.js";
import { loadConfig } from "../config/load.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter } from "../github/types.js";
import { runCommand } from "../runner/command-runner.js";
import { loadAndLintPlan } from "../shape/plan.js";
import { readWorkflowFacts } from "../status/reader.js";
import type { PromptAdapter } from "../prompt/prompt-adapter.js";

export interface ReviewOptions { issue: number; dryRun: boolean; interactive?: boolean; cwd: string; reviewModel?: string; externalReviewTool?: RalphexReviewOptions["externalReviewTool"]; }
export interface ReviewSummary { issue: number; state: "DryRun" | "Reviewed"; pullRequest: number; branch: string; planPath: string; }
export interface ReviewDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
  ralphex: typeof runRalphexReview;
  validation: typeof runValidation;
  prompt: Pick<PromptAdapter, "input" | "select">;
}
const defaults: ReviewDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter, ralphex: runRalphexReview, validation: runValidation, prompt: { input: async (_message, value = "") => value, select: async (_message, _choices, value) => value } };

export async function reviewIssue(options: ReviewOptions, dependencies: ReviewDependencies = defaults): Promise<CommandResult<ReviewSummary>> {
  if (!Number.isInteger(options.issue) || options.issue <= 0) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid Issue number: ${options.issue}`, remediation: "Pass a positive GitHub Issue number." }]);
  const git = await inspectGitContext(options.cwd, dependencies.execute);
  if (!git.ok) return git;
  const config = await loadConfig(join(git.data.root, ".saf/config.yaml"));
  if (!config.ok) return config;
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const facts = await readWorkflowFacts(config.data, options.issue, git.data.root, github.data, dependencies.execute);
  if (!facts.ok) return facts;
  const pullRequest = facts.data.pullRequest;
  const plan = facts.data.approvedPlan;
  if (!pullRequest || pullRequest.state !== "open" || pullRequest.merged || !facts.data.run || !plan?.planPath) return failure([{ code: "REVIEW_STATE_INVALID", severity: "error", message: `Issue #${options.issue} has no open Pull Request with an original plan.`, remediation: `Complete saf build ${options.issue} before running automated review.` }]);
  const planPath = resolve(git.data.root, plan.planPath);
  const loadedPlan = await loadAndLintPlan(planPath);
  if (!loadedPlan.ok) return loadedPlan;
  const tools = await checkBuildTools(git.data.root, dependencies.execute);
  if (!tools.ok) return tools;
  if (options.dryRun) return success({ issue: options.issue, state: "DryRun", pullRequest: pullRequest.number, branch: facts.data.run.branch, planPath });
  let externalReviewTool = options.externalReviewTool ?? config.data.review.externalReviewTool;
  let reviewModel = options.reviewModel ?? config.data.review.model;
  if (options.interactive) {
    if (options.externalReviewTool === undefined) externalReviewTool = await dependencies.prompt.select("External review tool", [
      { name: "None", value: "none" as const },
      { name: "Codex", value: "codex" as const },
      { name: "Custom", value: "custom" as const }
    ], externalReviewTool);
    if (options.reviewModel === undefined) reviewModel = normalizeModel(await dependencies.prompt.input("Review model (empty uses Ralphex default)", reviewModel));
  }
  const branch = await ensureRunBranch(git.data.root, facts.data.run.branch, facts.data.git.localBranches, facts.data.git.remoteBranches, dependencies.execute);
  if (!branch.ok) return branch;
  const reviewed = await dependencies.ralphex(git.data.root, planPath, {
    baseRef: config.data.repository.defaultBranch,
    externalReviewTool,
    ...(reviewModel ? { reviewModel } : {})
  }, dependencies.execute);
  if (!reviewed.ok) return reviewed;
  const validation = await dependencies.validation(git.data.root, config.data.validation.commands, dependencies.execute);
  if (!validation.ok) return validation;
  const pushed = await pushBranch(git.data.root, facts.data.run.branch, dependencies.execute);
  if (!pushed.ok) return pushed;
  return success({ issue: options.issue, state: "Reviewed", pullRequest: pullRequest.number, branch: facts.data.run.branch, planPath });
}

function normalizeModel(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
