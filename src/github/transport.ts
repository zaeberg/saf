import { Octokit } from "octokit";

export interface GitHubTransport {
  getRepository(owner: string, repository: string): Promise<unknown>;
  getProject(owner: string, number: number): Promise<unknown>;
  getIssue(owner: string, repository: string, issue: number): Promise<unknown>;
  getIssueComments(owner: string, repository: string, issue: number): Promise<unknown[]>;
  getProjectItem(owner: string, number: number, repository: string, issue: number): Promise<unknown>;
  getPullRequest(owner: string, repository: string, pullRequest: number): Promise<unknown>;
  getChecks(owner: string, repository: string, sha: string): Promise<unknown>;
  updateProjectItemStatus(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<unknown>;
  createIssueComment(owner: string, repository: string, issue: number, body: string): Promise<unknown>;
  updateIssueComment(owner: string, repository: string, commentId: number, body: string): Promise<unknown>;
  listPullRequests(owner: string, repository: string, branch: string): Promise<unknown[]>;
  createPullRequest(owner: string, repository: string, input: { title: string; body: string; branch: string; base: string }): Promise<unknown>;
  updatePullRequest(owner: string, repository: string, pullRequest: number, input: { title: string; body: string }): Promise<unknown>;
  addProjectItem(projectId: string, contentId: string): Promise<unknown>;
}

const projectQuery = `query($owner:String!,$number:Int!,$cursor:String){
  owner: repositoryOwner(login:$owner){
    ... on Organization {projectV2(number:$number){...ProjectData}}
    ... on User {projectV2(number:$number){...ProjectData}}
  }
}
fragment ProjectData on ProjectV2 {
  id title
  fields(first:100){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}
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
  content{__typename ... on Issue{number repository{nameWithOwner}} ... on PullRequest{number repository{nameWithOwner}}}
  fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
}`;

const updateProjectItemStatusMutation = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){
  updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}
}`;
const addProjectItemMutation = `mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}`;

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


  async updateProjectItemStatus(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<unknown> {
    return this.#client.graphql(updateProjectItemStatusMutation, { projectId, itemId, fieldId, optionId });
  }

  async createIssueComment(owner: string, repository: string, issue: number, body: string): Promise<unknown> {
    return (await this.#client.rest.issues.createComment({ owner, repo: repository, issue_number: issue, body })).data;
  }

  async updateIssueComment(owner: string, repository: string, commentId: number, body: string): Promise<unknown> {
    return (await this.#client.rest.issues.updateComment({ owner, repo: repository, comment_id: commentId, body })).data;
  }

  async listPullRequests(owner: string, repository: string, branch: string): Promise<unknown[]> {
    return this.#client.paginate(this.#client.rest.pulls.list, { owner, repo: repository, state: "all", head: `${owner}:${branch}`, per_page: 100 });
  }

  async createPullRequest(owner: string, repository: string, input: { title: string; body: string; branch: string; base: string }): Promise<unknown> {
    return (await this.#client.rest.pulls.create({ owner, repo: repository, title: input.title, body: input.body, head: input.branch, base: input.base, draft: true })).data;
  }

  async updatePullRequest(owner: string, repository: string, pullRequest: number, input: { title: string; body: string }): Promise<unknown> {
    return (await this.#client.rest.pulls.update({ owner, repo: repository, pull_number: pullRequest, title: input.title, body: input.body })).data;
  }

  async addProjectItem(projectId: string, contentId: string): Promise<unknown> {
    return this.#client.graphql(addProjectItemMutation, { projectId, contentId });
  }

}

export function createOctokitTransport(token: string): GitHubTransport {
  return new OctokitTransport(new Octokit({ auth: token }));
}
