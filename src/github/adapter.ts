import { z } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { ProjectReference } from "../init/project-reference.js";
import type { GitHubTransport } from "./transport.js";
import { requiredProjectStatuses, type GitHubAdapter, type ProjectDetails, type RepositoryDetails } from "./types.js";

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
