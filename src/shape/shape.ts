import { relative, resolve } from "node:path";
import { loadConfig } from "../config/load.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { inspectGitContext } from "../git/context.js";
import { createAuthenticatedGitHubAdapter } from "../github/auth.js";
import type { GitHubAdapter } from "../github/types.js";
import type { PromptAdapter } from "../prompt/prompt-adapter.js";
import { runCommand } from "../runner/command-runner.js";
import { readWorkflowFacts } from "../status/reader.js";
import { deriveState } from "../status/reducer.js";
import { hashPlan, parseMarkers, serializeMarker, type ApprovedPlanMarker } from "../status/markers.js";
import { loadAndLintPlan } from "./plan.js";
import { revisePlan, runPlanner } from "./planner.js";
import { reviewPlan } from "./review.js";

export interface ShapeOptions { issue: number; planPath?: string; dryRun: boolean; yes: boolean; interactive: boolean; cwd: string; }
export interface ShapeSummary { issue: number; state: "Ready" | "DryRun"; planPath: string; revision: number; sha256: string; commentChanged: boolean; }
export interface ShapeDependencies {
  execute: typeof runCommand;
  github: (cwd: string, execute: typeof runCommand) => Promise<CommandResult<GitHubAdapter>>;
  prompt: Pick<PromptAdapter, "confirm">;
  planner: typeof runPlanner;
  reviser: typeof revisePlan;
  reviewer: typeof reviewPlan;
}
const defaults: ShapeDependencies = { execute: runCommand, github: createAuthenticatedGitHubAdapter, prompt: { confirm: async () => false }, planner: runPlanner, reviser: revisePlan, reviewer: reviewPlan };

export async function shapeIssue(options: ShapeOptions, dependencies: ShapeDependencies = defaults): Promise<CommandResult<ShapeSummary>> {
  if (!Number.isInteger(options.issue) || options.issue <= 0) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid Issue number: ${options.issue}`, remediation: "Pass a positive GitHub Issue number." }]);
  const git = await inspectGitContext(options.cwd, dependencies.execute);
  if (!git.ok) return git;
  const config = await loadConfig(resolve(git.data.root, ".saf/config.yaml"));
  if (!config.ok) return config;
  if (config.data.github.repository.toLowerCase() !== git.data.repository.toLowerCase()) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: "Configured repository differs from Git origin.", remediation: "Restore the configured origin before shaping." }]);
  const github = await dependencies.github(git.data.root, dependencies.execute);
  if (!github.ok) return github;
  const facts = await readWorkflowFacts(config.data, options.issue, git.data.root, github.data, dependencies.execute);
  if (!facts.ok) return facts;
  const derivation = deriveState(facts.data);
  if (!(["Inbox", "Shaping", "Ready"] as const).includes(derivation.state as "Inbox" | "Shaping" | "Ready")) return failure([{ code: "SHAPE_STATE_INVALID", severity: "error", message: `Issue #${options.issue} cannot be shaped from ${derivation.state}.`, remediation: derivation.blockers.map((finding) => finding.message).join(" ") || "Resolve the current workflow state first." }]);
  const tools = await checkShapeTools(git.data.root, dependencies.execute);
  if (!tools.ok) return tools;

  let planPath = options.planPath ? resolve(options.cwd, options.planPath) : undefined;
  let projectStatus = facts.data.projectItem.status;
  if (!planPath && !options.interactive) return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: "Interactive planner is unavailable in a non-interactive terminal.", remediation: "Run in a TTY or pass --plan <path>." }]);

  if (!planPath) {
    if (!options.dryRun && facts.data.projectItem.status !== "Shaping") {
      const transition = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Shaping");
      if (!transition.ok) return transition;
      projectStatus = "Shaping";
    }
    if (options.dryRun) return failure([{ code: "PLAN_NOT_FOUND", severity: "error", message: "Dry-run does not launch the interactive planner.", remediation: "Pass --plan <path> to validate a plan in dry-run mode." }]);
    const planned = await dependencies.planner(git.data.root, config.data.documentation.plansDirectory, facts.data.issue, dependencies.execute);
    if (!planned.ok) return planned;
    planPath = planned.data;
  }

  let plan = await loadAndLintPlan(planPath);
  if (!plan.ok) return plan;
  const existing = facts.data.approvedPlan;
  const initialHash = hashPlan(plan.data.content);
  if (existing?.sha256 === initialHash) {
    if (!options.dryRun && projectStatus !== "Ready") {
      const ready = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Ready");
      if (!ready.ok) return ready;
    }
    return success({ issue: options.issue, state: options.dryRun ? "DryRun" : "Ready", planPath, revision: existing.revision, sha256: existing.sha256, commentChanged: false });
  }

  const revision = (existing?.revision ?? 0) + 1;
  if (options.dryRun) return success({ issue: options.issue, state: "DryRun", planPath, revision, sha256: initialHash, commentChanged: false });
  if (projectStatus !== "Shaping") {
    const transition = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Shaping");
    if (!transition.ok) return transition;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const annotationsPath = resolve(git.data.root, ".saf/runtime/shape", `issue-${options.issue}-annotations.md`);
    const review = await dependencies.reviewer(git.data.root, planPath, annotationsPath, dependencies.execute);
    if (!review.ok) return review;
    if (!review.data.annotations) break;
    if (!options.interactive) return failure([{ code: "PLAN_REVIEW_REQUIRED", severity: "error", message: "revdiff produced annotations in a non-interactive run.", remediation: `Resolve annotations in ${annotationsPath} and rerun saf shape.` }]);
    const revised = await dependencies.reviser(git.data.root, planPath, annotationsPath, dependencies.execute);
    if (!revised.ok) return revised;
    plan = await loadAndLintPlan(planPath);
    if (!plan.ok) return plan;
    if (attempt === 9) return failure([{ code: "PLAN_REVIEW_REQUIRED", severity: "error", message: "Plan review exceeded the revision limit.", remediation: "Resolve annotations manually and rerun saf shape." }]);
  }

  const approved = options.yes || await dependencies.prompt.confirm(`Approve plan revision r${revision} for Issue #${options.issue}?`, false);
  if (!approved) return failure([{ code: "PLAN_APPROVAL_REQUIRED", severity: "error", message: "Plan was not explicitly approved.", remediation: "Review the plan and confirm approval." }]);
  plan = await loadAndLintPlan(planPath);
  if (!plan.ok) return plan;
  const relativePlanPath = relative(git.data.root, planPath);
  const marker: ApprovedPlanMarker = { version: 1, kind: "approved-plan", issue: options.issue, revision, normalizationVersion: 1, sha256: hashPlan(plan.data.content), plan: plan.data.content, ...(!relativePlanPath.startsWith("..") ? { planPath: relativePlanPath } : {}) };
  const markerBody = serializeMarker(marker);
  const parsed = parseMarkers(facts.data.issue.comments, options.issue);
  const existingCommentIds = parsed.approvedPlanCommentIds ?? [];
  if (existingCommentIds.length === 0) {
    const comment = await github.data.createIssueComment(config.data.github.repository, options.issue, markerBody);
    if (!comment.ok) return comment;
  } else {
    for (const commentId of existingCommentIds) {
      const comment = await github.data.updateIssueComment(config.data.github.repository, commentId, markerBody);
      if (!comment.ok) return comment;
    }
  }
  const ready = await github.data.setProjectItemStatus(config.data.github.project, config.data.github.repository, facts.data.projectItem.id, "Ready");
  if (!ready.ok) return ready;
  return success({ issue: options.issue, state: "Ready", planPath, revision, sha256: marker.sha256, commentChanged: true });
}

async function checkShapeTools(root: string, execute: typeof runCommand): Promise<CommandResult<void>> {
  const [planner, reviewer] = await Promise.all([
    execute({ command: "claude", args: ["--version"], cwd: root }),
    execute({ command: "revdiff", args: ["--version"], cwd: root })
  ]);
  if (!planner.ok) return failure([{ code: "TOOL_NOT_FOUND", severity: "error", message: "Claude Code planner is unavailable.", remediation: "Install or repair claude before shaping." }]);
  if (!reviewer.ok) return failure([{ code: "TOOL_NOT_FOUND", severity: "error", message: "revdiff is unavailable.", remediation: "Install or repair revdiff before shaping." }]);
  return success(undefined);
}
