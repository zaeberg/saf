import type { SafConfigV1 } from "../config/schema.js";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { GitHubAdapter, PullRequestDetails } from "../github/types.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";
import type { GitFacts, WorkflowFacts } from "./facts.js";
import { parseMarkers } from "./markers.js";

export type StatusExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function readWorkflowFacts(config: SafConfigV1, issueNumber: number, root: string, github: GitHubAdapter, execute: StatusExecutor = runCommand): Promise<CommandResult<WorkflowFacts>> {
  const projectReference = config.github.project;
  const [issueResult, projectItemResult, gitResult] = await Promise.all([
    github.getIssue(config.github.repository, issueNumber),
    github.getProjectItem(projectReference, config.github.repository, issueNumber),
    readGitFacts(root, execute)
  ]);
  if (!issueResult.ok) return issueResult;
  if (!projectItemResult.ok) return projectItemResult;
  if (!gitResult.ok) return gitResult;

  const issueMarkers = parseMarkers(issueResult.data.comments, issueNumber);
  let pullRequest: PullRequestDetails | null = null;
  if (issueMarkers.run?.pullRequest) {
    const pullRequestResult = await github.getPullRequest(config.github.repository, issueMarkers.run.pullRequest);
    if (pullRequestResult.ok) pullRequest = pullRequestResult.data;
    else if (!pullRequestResult.diagnostics.some((diagnostic) => diagnostic.code === "GITHUB_NOT_FOUND")) return pullRequestResult;
  }

  let checks = null;
  const markerFindings = [...issueMarkers.findings];
  if (pullRequest) {
    const checksResult = await github.getChecks(config.github.repository, pullRequest.headSha);
    if (!checksResult.ok) return checksResult;
    checks = checksResult.data;
  }

  return success({
    issue: issueResult.data,
    projectItem: projectItemResult.data,
    approvedPlan: issueMarkers.approvedPlan ?? null,
    run: issueMarkers.run ?? null,
    pullRequest,
    checks,
    git: gitResult.data,
    markerFindings
  });
}

async function readGitFacts(root: string, execute: StatusExecutor): Promise<CommandResult<GitFacts>> {
  const [current, local, remote] = await Promise.all([
    execute({ command: "git", args: ["branch", "--show-current"], cwd: root }),
    execute({ command: "git", args: ["branch", "--format=%(refname:short)"], cwd: root }),
    execute({ command: "git", args: ["branch", "-r", "--format=%(refname:short)"], cwd: root })
  ]);
  if (!local.ok || !remote.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to read Git branches.", remediation: "Check the local Git repository and retry." }]);
  return success({ currentBranch: current.ok && current.data.stdout.trim() ? current.data.stdout.trim() : null, localBranches: lines(local.data.stdout), remoteBranches: lines(remote.data.stdout).map((branch) => branch.replace(/^origin\//, "")) });
}

function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}
