import type { CommandResult } from "../contracts/result.js";
import type { ProjectReference } from "../init/project-reference.js";

export const requiredProjectStatuses = ["Backlog", "Shaping", "Ready", "Running", "Review", "Blocked", "Done"] as const;

export interface RepositoryDetails {
  repository: string;
  defaultBranch: string;
}

export interface ProjectDetails {
  id: string;
  title: string;
  statusOptions: Array<{ id: string; name: string }>;
}

export interface GitHubAdapter {
  getRepository(repository: string): Promise<CommandResult<RepositoryDetails>>;
  getProject(reference: ProjectReference, repository: string): Promise<CommandResult<ProjectDetails>>;
}
