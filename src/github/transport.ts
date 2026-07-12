import { Octokit } from "octokit";

export interface GitHubTransport {
  getRepository(owner: string, repository: string): Promise<unknown>;
  getProject(owner: string, number: number): Promise<unknown>;
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

export class OctokitTransport implements GitHubTransport {
  readonly #client: Pick<Octokit, "rest" | "graphql">;

  constructor(client: Pick<Octokit, "rest" | "graphql">) {
    this.#client = client;
  }

  async getRepository(owner: string, repository: string): Promise<unknown> {
    const response = await this.#client.rest.repos.get({ owner, repo: repository });
    return response.data;
  }

  async getProject(owner: string, number: number): Promise<unknown> {
    return this.#client.graphql.paginate(projectQuery, { owner, number });
  }
}

export function createOctokitTransport(token: string): GitHubTransport {
  return new OctokitTransport(new Octokit({ auth: token }));
}
