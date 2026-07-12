import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { OctokitTransport } from "../src/github/transport.js";

describe("OctokitTransport", () => {
  it("uses REST for repository facts", async () => {
    const get = vi.fn(async () => ({ data: { full_name: "zbrg/saf" } }));
    const client = { rest: { repos: { get } }, graphql: Object.assign(vi.fn(), { paginate: vi.fn() }) } as unknown as Pick<Octokit, "rest" | "graphql">;
    const transport = new OctokitTransport(client);
    await expect(transport.getRepository("zbrg", "saf")).resolves.toEqual({ full_name: "zbrg/saf" });
    expect(get).toHaveBeenCalledWith({ owner: "zbrg", repo: "saf" });
  });

  it("delegates complete ProjectV2 pagination to Octokit", async () => {
    const paginated = { owner: { projectV2: { items: { nodes: [{ id: "one" }, { id: "two" }] } } } };
    const paginate = vi.fn(async (query: string, variables: unknown) => {
      void query;
      void variables;
      return paginated;
    });
    const client = { rest: {}, graphql: Object.assign(vi.fn(), { paginate }) } as unknown as Pick<Octokit, "rest" | "graphql">;
    const transport = new OctokitTransport(client);
    await expect(transport.getProject("zbrg", 5)).resolves.toBe(paginated);
    expect(paginate).toHaveBeenCalledWith(expect.stringContaining("items(first:100,after:$cursor)"), { owner: "zbrg", number: 5 });
    expect(paginate.mock.calls[0]?.[0]).not.toContain("mutation");
  });
});
