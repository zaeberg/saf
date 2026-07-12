import { z } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { ProjectReference } from "../init/project-reference.js";
import type { GitHubTransport } from "./transport.js";
import { requiredProjectStatuses, type CheckDetails, type CommitStatusDetails, type GitHubAdapter, type IssueDetails, type ProjectDetails, type ProjectItemDetails, type PullRequestDetails, type RepositoryDetails } from "./types.js";

const repositorySchema = z.object({
  full_name: z.string(),
  has_issues: z.boolean(),
  default_branch: z.string().min(1)
});
const projectSchema = z.object({
  owner: z.object({
    projectV2: z.object({
      id: z.string(),
      title: z.string(),
      fields: z.object({ nodes: z.array(z.object({ name: z.string().optional(), options: z.array(z.object({ id: z.string(), name: z.string() })).optional() }).passthrough()) }),
      items: z.object({ nodes: z.array(z.object({ content: z.object({ repository: z.object({ nameWithOwner: z.string() }).optional() }).nullable().optional() }).passthrough()) })
    }).nullable()
  }).nullable()
});
const issueSchema = z.object({ number: z.number().int().positive(), title: z.string(), state: z.enum(["open", "closed"]), body: z.string().nullable(), pull_request: z.unknown().optional() });
const commentSchema = z.object({ id: z.number(), body: z.string().nullable(), created_at: z.string(), updated_at: z.string() });
const projectItemSchema = z.object({ owner: z.object({ projectV2: z.object({ items: z.object({ nodes: z.array(z.object({
  id: z.string(),
  content: z.object({ number: z.number(), repository: z.object({ nameWithOwner: z.string() }) }).optional().nullable(),
  fieldValueByName: z.object({ name: z.string() }).optional().nullable()
}).passthrough()) }) }).nullable() }).nullable() });
const pullRequestSchema = z.object({ number: z.number(), state: z.enum(["open", "closed"]), draft: z.boolean(), merged_at: z.string().nullable(), html_url: z.string(), head: z.object({ sha: z.string(), ref: z.string() }) });
const checksSchema = z.object({ total_count: z.number(), check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })) });
const statusSchema = z.object({ sha: z.string(), context: z.string(), state: z.string() });

export class DefaultGitHubAdapter implements GitHubAdapter {
  readonly #transport: GitHubTransport;

  constructor(transport: GitHubTransport) {
    this.#transport = transport;
  }

  async getRepository(repository: string): Promise<CommandResult<RepositoryDetails>> {
    const parts = splitRepository(repository);
    if (!parts.ok) return parts;
    try {
      const parsed = repositorySchema.safeParse(await this.#transport.getRepository(parts.data.owner, parts.data.repository));
      if (!parsed.success) return invalidResponse("repository");
      if (parsed.data.full_name.toLowerCase() !== repository.toLowerCase()) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `GitHub returned repository ${parsed.data.full_name} for ${repository}.`, remediation: "Check origin and GitHub access." }]);
      if (!parsed.data.has_issues) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `Issues are disabled for ${repository}.`, remediation: "Enable GitHub Issues before initializing SAF." }]);
      return success({ repository: parsed.data.full_name, defaultBranch: parsed.data.default_branch });
    } catch (error: unknown) {
      return githubFailure(error, `repository ${repository}`);
    }
  }

  async getProject(reference: ProjectReference, repository: string): Promise<CommandResult<ProjectDetails>> {
    try {
      const parsed = projectSchema.safeParse(await this.#transport.getProject(reference.owner, reference.number));
      if (!parsed.success) return invalidResponse("ProjectV2");
      const project = parsed.data.owner?.projectV2;
      if (!project) return failure([{ code: "GITHUB_NOT_FOUND", severity: "error", message: `GitHub Project ${reference.owner}/${reference.number} was not found.`, remediation: "Verify owner, number and gh project scope." }]);
      const repositories = new Set(project.items.nodes.flatMap((item) => item.content?.repository?.nameWithOwner.toLowerCase() ?? []));
      const foreign = [...repositories].filter((slug) => slug !== repository.toLowerCase());
      if (foreign.length > 0) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Project contains items from other repositories: ${foreign.join(", ")}.`, remediation: "Use a repository-scoped Project containing only this repository." }]);
      const status = project.fields.nodes.find((field) => field.name === "Status");
      if (!status?.options) return failure([{ code: "PROJECT_STATUS_FIELD_MISSING", severity: "error", message: "Project field Status is missing or is not a single-select field.", remediation: "Create a single-select Status field with all SAF MVP options." }]);
      const available = new Set(status.options.map((option) => option.name));
      const missing = requiredProjectStatuses.filter((name) => !available.has(name));
      if (missing.length > 0) return failure([{ code: "PROJECT_STATUS_OPTION_MISSING", severity: "error", message: `Status is missing options: ${missing.join(", ")}.`, remediation: "Add all required SAF MVP Status options." }]);
      return success({ id: project.id, title: project.title, statusOptions: status.options });
    } catch (error: unknown) {
      return githubFailure(error, `Project ${reference.owner}/${reference.number}`);
    }
  }

  async getIssue(repository: string, issue: number): Promise<CommandResult<IssueDetails>> {
    const parts = splitRepository(repository);
    if (!parts.ok) return parts;
    try {
      const [issueResponse, commentsResponse] = await Promise.all([
        this.#transport.getIssue(parts.data.owner, parts.data.repository, issue),
        this.#transport.getIssueComments(parts.data.owner, parts.data.repository, issue)
      ]);
      const parsedIssue = issueSchema.safeParse(issueResponse);
      const parsedComments = z.array(commentSchema).safeParse(commentsResponse);
      if (!parsedIssue.success || !parsedComments.success) return invalidResponse("Issue");
      if (parsedIssue.data.pull_request !== undefined) return failure([{ code: "GITHUB_NOT_FOUND", severity: "error", message: `#${issue} is a Pull Request, not an Issue.`, remediation: "Pass the GitHub Issue number linked to the workflow." }]);
      return success({
        number: parsedIssue.data.number,
        title: parsedIssue.data.title,
        state: parsedIssue.data.state,
        body: parsedIssue.data.body ?? "",
        comments: parsedComments.data.map((comment) => ({ id: comment.id, body: comment.body ?? "", createdAt: comment.created_at, updatedAt: comment.updated_at }))
      });
    } catch (error: unknown) {
      return githubFailure(error, `Issue ${repository}#${issue}`);
    }
  }

  async getProjectItem(reference: ProjectReference, repository: string, issue: number): Promise<CommandResult<ProjectItemDetails>> {
    try {
      const parsed = projectItemSchema.safeParse(await this.#transport.getProjectItem(reference.owner, reference.number, repository, issue));
      if (!parsed.success) return invalidResponse("Project item");
      const nodes = parsed.data.owner?.projectV2?.items.nodes ?? [];
      const foreignRepositories = [...new Set(nodes.flatMap((node) => node.content?.repository.nameWithOwner.toLowerCase() ?? []))].filter((slug) => slug !== repository.toLowerCase());
      if (foreignRepositories.length > 0) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Project contains items from other repositories: ${foreignRepositories.join(", ")}.`, remediation: "Remove foreign repository items from the configured Project." }]);
      const matches = nodes.filter((node) => node.content?.number === issue && node.content.repository.nameWithOwner.toLowerCase() === repository.toLowerCase());
      if (matches.length === 0) return failure([{ code: "GITHUB_NOT_FOUND", severity: "error", message: `Issue #${issue} is not in Project ${reference.owner}/${reference.number}.`, remediation: "Add the Issue to the configured Project." }]);
      if (matches.length > 1) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Issue #${issue} has duplicate Project items.`, remediation: "Remove duplicate Project items before continuing." }]);
      return success({ id: matches[0]!.id, status: matches[0]!.fieldValueByName?.name ?? null });
    } catch (error: unknown) {
      return githubFailure(error, `Project item for Issue #${issue}`);
    }
  }

  async getPullRequest(repository: string, pullRequest: number): Promise<CommandResult<PullRequestDetails>> {
    const parts = splitRepository(repository);
    if (!parts.ok) return parts;
    try {
      const [pullRequestResponse, commentsResponse] = await Promise.all([
        this.#transport.getPullRequest(parts.data.owner, parts.data.repository, pullRequest),
        this.#transport.getIssueComments(parts.data.owner, parts.data.repository, pullRequest)
      ]);
      const parsed = pullRequestSchema.safeParse(pullRequestResponse);
      const comments = z.array(commentSchema).safeParse(commentsResponse);
      if (!parsed.success || !comments.success) return invalidResponse("Pull Request");
      return success({ number: parsed.data.number, state: parsed.data.state, draft: parsed.data.draft, merged: parsed.data.merged_at !== null, headSha: parsed.data.head.sha, branch: parsed.data.head.ref, url: parsed.data.html_url, comments: comments.data.map((comment) => ({ id: comment.id, body: comment.body ?? "", createdAt: comment.created_at, updatedAt: comment.updated_at })) });
    } catch (error: unknown) {
      return githubFailure(error, `Pull Request ${repository}#${pullRequest}`);
    }
  }

  async getChecks(repository: string, sha: string): Promise<CommandResult<CheckDetails>> {
    const parts = splitRepository(repository);
    if (!parts.ok) return parts;
    try {
      const parsed = checksSchema.safeParse(await this.#transport.getChecks(parts.data.owner, parts.data.repository, sha));
      if (!parsed.success) return invalidResponse("checks");
      if (parsed.data.total_count === 0) return success({ state: "missing", total: 0, failing: [] });
      const failing = parsed.data.check_runs.filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion ?? "")).map((check) => check.name);
      const pending = parsed.data.check_runs.some((check) => check.status !== "completed");
      return success({ state: failing.length > 0 ? "failure" : pending ? "pending" : "success", total: parsed.data.total_count, failing });
    } catch (error: unknown) {
      return githubFailure(error, `checks for ${sha}`);
    }
  }

  async getCommitStatus(repository: string, sha: string, context: string): Promise<CommandResult<CommitStatusDetails>> {
    const parts = splitRepository(repository);
    if (!parts.ok) return parts;
    try {
      const parsed = z.array(statusSchema).safeParse(await this.#transport.getCommitStatuses(parts.data.owner, parts.data.repository, sha));
      if (!parsed.success) return invalidResponse("commit statuses");
      const latest = parsed.data.find((status) => status.sha === sha && status.context === context);
      return success({ present: latest?.state === "success", sha });
    } catch (error: unknown) {
      return githubFailure(error, `commit statuses for ${sha}`);
    }
  }
}

function splitRepository(value: string): CommandResult<{ owner: string; repository: string }> {
  const [owner, repository, extra] = value.split("/");
  if (!owner || !repository || extra) return failure([{ code: "CONFIG_INVALID", severity: "error", message: `Invalid GitHub repository: ${value}`, remediation: "Use owner/repository format." }]);
  return success({ owner, repository });
}

function invalidResponse(resource: string): CommandResult<never> {
  return failure([{ code: "GITHUB_RESPONSE_INVALID", severity: "error", message: `GitHub returned an unexpected ${resource} response.`, remediation: "Retry and update SAF if the GitHub schema changed." }]);
}

function githubFailure(error: unknown, resource: string): CommandResult<never> {
  const status = errorStatus(error);
  if (status === 401) return failure([{ code: "GITHUB_AUTH_MISSING", severity: "error", message: "GitHub authentication is missing or expired.", remediation: "Run gh auth login and retry." }]);
  if (status === 429 || isRateLimitError(error)) return failure([{ code: "GITHUB_RATE_LIMITED", severity: "error", message: "GitHub API rate limit was exceeded.", remediation: "Wait for the rate limit reset and retry." }]);
  if (status === 403) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `Access to ${resource} was denied.`, remediation: "Check gh token scopes and repository/Project access." }]);
  if (status === 404) return failure([{ code: "GITHUB_NOT_FOUND", severity: "error", message: `${resource} was not found.`, remediation: "Verify the configured repository or Project reference." }]);
  return failure([{ code: "COMMAND_FAILED", severity: "error", message: `GitHub request failed for ${resource}.`, remediation: "Check network availability and retry." }]);
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /rate limit/i.test(error.message);
}
