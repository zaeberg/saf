import { Octokit } from "octokit";

export interface GitHubTransport {
  getRepository(owner: string, repository: string): Promise<unknown>;
  getProject(owner: string, number: number): Promise<unknown>;
  getIssue(owner: string, repository: string, issue: number): Promise<unknown>;
  getIssueComments(owner: string, repository: string, issue: number): Promise<unknown[]>;
  getProjectItem(owner: string, number: number, repository: string, issue: number): Promise<unknown>;
  getPullRequest(owner: string, repository: string, pullRequest: number): Promise<unknown>;
  getChecks(owner: string, repository: string, sha: string): Promise<unknown>;
  getCommitStatuses(owner: string, repository: string, sha: string): Promise<unknown[]>;
}

const projectQuery = `query($owner:String!,$number:Int!,$cursor:String){
  owner: repositoryOwner(login:$owner){
    ... on Organization {projectV2(number:$number){...ProjectData}}
    ... on User {projectV2(number:$number){...ProjectData}}
  }
}
fragment ProjectData on ProjectV2 {
  id title
  fields(first:100){nodes{... on ProjectV2SingleSelectField{name options{id name}}}}
  items(first:100,after:$cursor){nodes{content{... on Issue{repository{nameWithOwner}} ... on PullRequest{repository{nameWithOwner}}}} pageInfo{hasNextPage endCursor}}
}`;

const projectItemQuery = `query($owner:String!,$number:Int!,$cursor:String){
  owner: repositoryOwner(login:$owner){
    ... on Organization {projectV2(number:$number){items(first:100,after:$cursor){nodes{...ProjectItemData} pageInfo{hasNextPage endCursor}}}}
    ... on User {projectV2(number:$number){items(first:100,after:$cursor){nodes{...ProjectItemData} pageInfo{hasNextPage endCursor}}}}
  }
}
fragment ProjectItemData on ProjectV2Item {
  id
  content{... on Issue{number repository{nameWithOwner}}}
  fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
}`;

export class OctokitTransport implements GitHubTransport {
  readonly #client: Pick<Octokit, "rest" | "graphql" | "paginate">;

  constructor(client: Pick<Octokit, "rest" | "graphql" | "paginate">) {
    this.#client = client;
  }

  async getRepository(owner: string, repository: string): Promise<unknown> {
    const response = await this.#client.rest.repos.get({ owner, repo: repository });
    return response.data;
  }

  async getProject(owner: string, number: number): Promise<unknown> {
    return this.#client.graphql.paginate(projectQuery, { owner, number });
  }


  async getIssue(owner: string, repository: string, issue: number): Promise<unknown> {
    return (await this.#client.rest.issues.get({ owner, repo: repository, issue_number: issue })).data;
  }

  async getIssueComments(owner: string, repository: string, issue: number): Promise<unknown[]> {
    return this.#client.paginate(this.#client.rest.issues.listComments, { owner, repo: repository, issue_number: issue, per_page: 100 });
  }

  async getProjectItem(owner: string, number: number, repository: string, issue: number): Promise<unknown> {
    void repository;
    void issue;
    return this.#client.graphql.paginate(projectItemQuery, { owner, number });
  }

  async getPullRequest(owner: string, repository: string, pullRequest: number): Promise<unknown> {
    return (await this.#client.rest.pulls.get({ owner, repo: repository, pull_number: pullRequest })).data;
  }

  async getChecks(owner: string, repository: string, sha: string): Promise<unknown> {
    const checkRuns = await this.#client.paginate(this.#client.rest.checks.listForRef, { owner, repo: repository, ref: sha, per_page: 100 });
    return { total_count: checkRuns.length, check_runs: checkRuns };
  }

  async getCommitStatuses(owner: string, repository: string, sha: string): Promise<unknown[]> {
    return this.#client.paginate(this.#client.rest.repos.listCommitStatusesForRef, { owner, repo: repository, ref: sha, per_page: 100 });
  }
}

export function createOctokitTransport(token: string): GitHubTransport {
  return new OctokitTransport(new Octokit({ auth: token }));
}
