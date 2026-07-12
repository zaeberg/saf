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
  statusFieldId: string;
  statusOptions: Array<{ id: string; name: string }>;
}

export interface IssueDetails {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  comments: Array<{ id: number; body: string; createdAt: string; updatedAt: string }>;
}

export interface ProjectItemDetails {
  id: string;
  status: string | null;
}

export interface PullRequestDetails {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  headSha: string;
  branch: string;
  url: string;
  comments: Array<{ id: number; body: string; createdAt: string; updatedAt: string }>;
}

export interface CheckDetails {
  state: "success" | "failure" | "pending" | "missing";
  total: number;
  failing: string[];
}

export interface CommitStatusDetails {
  present: boolean;
  sha: string;
}

export interface GitHubAdapter {
  getRepository(repository: string): Promise<CommandResult<RepositoryDetails>>;
  getProject(reference: ProjectReference, repository: string): Promise<CommandResult<ProjectDetails>>;
  getIssue(repository: string, issue: number): Promise<CommandResult<IssueDetails>>;
  getProjectItem(reference: ProjectReference, repository: string, issue: number): Promise<CommandResult<ProjectItemDetails>>;
  getPullRequest(repository: string, pullRequest: number): Promise<CommandResult<PullRequestDetails>>;
  getChecks(repository: string, sha: string): Promise<CommandResult<CheckDetails>>;
  getCommitStatus(repository: string, sha: string, context: string): Promise<CommandResult<CommitStatusDetails>>;
  setProjectItemStatus(reference: ProjectReference, repository: string, projectItemId: string, status: string): Promise<CommandResult<void>>;
  createIssueComment(repository: string, issue: number, body: string): Promise<CommandResult<{ id: number }>>;
  updateIssueComment(repository: string, commentId: number, body: string): Promise<CommandResult<{ id: number }>>;
}
