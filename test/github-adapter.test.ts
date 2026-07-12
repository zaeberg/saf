import { describe, expect, it, vi } from "vitest";
import { DefaultGitHubAdapter } from "../src/github/adapter.js";
import type { GitHubTransport } from "../src/github/transport.js";
import { requiredProjectStatuses } from "../src/github/types.js";

describe("GitHubAdapter", () => {
  it("reads repository facts", async () => {
    const adapter = new DefaultGitHubAdapter(transport());
    await expect(adapter.getRepository("zbrg/saf")).resolves.toMatchObject({ ok: true, data: { repository: "zbrg/saf", defaultBranch: "master" } });
  });

  it("accepts all paginated Project items", async () => {
    const adapter = new DefaultGitHubAdapter(transport());
    await expect(adapter.getProject({ owner: "zbrg", number: 5 }, "zbrg/saf")).resolves.toMatchObject({ ok: true, data: { id: "PVT_1", title: "SAF" } });
  });

  it("rejects foreign repository items", async () => {
    const adapter = new DefaultGitHubAdapter(transport({ repository: "other/repo" }));
    await expect(adapter.getProject({ owner: "zbrg", number: 5 }, "zbrg/saf")).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "PROJECT_REPOSITORY_DRIFT" }] });
  });

  it("reports a missing Status field", async () => {
    const adapter = new DefaultGitHubAdapter(transport({ fields: [] }));
    await expect(adapter.getProject({ owner: "zbrg", number: 5 }, "zbrg/saf")).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "PROJECT_STATUS_FIELD_MISSING" }] });
  });

  it.each([
    [401, "GITHUB_AUTH_MISSING"],
    [403, "PROJECT_ACCESS_DENIED"],
    [404, "GITHUB_NOT_FOUND"],
    [429, "GITHUB_RATE_LIMITED"]
  ])("maps HTTP %s without leaking transport errors", async (status, code) => {
    const adapter = new DefaultGitHubAdapter(transport({ error: Object.assign(new Error("sensitive transport detail"), { status }) }));
    const result = await adapter.getRepository("zbrg/saf");
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code }] });
    expect(JSON.stringify(result)).not.toContain("sensitive transport detail");
  });

  it("rejects invalid runtime responses", async () => {
    const adapter = new DefaultGitHubAdapter(transport({ repositoryResponse: { unexpected: true } }));
    await expect(adapter.getRepository("zbrg/saf")).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "GITHUB_RESPONSE_INVALID" }] });
  });

  it("distinguishes a rate-limited 403 from access denied", async () => {
    const error = Object.assign(new Error("API rate limit exceeded"), { status: 403 });
    const adapter = new DefaultGitHubAdapter(transport({ error }));
    await expect(adapter.getRepository("zbrg/saf")).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "GITHUB_RATE_LIMITED" }] });
  });

  it("reads Issue comments and its Project status", async () => {
    const base = transport();
    const adapter = new DefaultGitHubAdapter({
      ...base,
      getIssue: async () => ({ number: 42, title: "Test", state: "open", body: null }),
      getIssueComments: async () => [{ id: 1, body: "comment", created_at: "2026-07-12T00:00:00Z", updated_at: "2026-07-12T00:00:00Z" }],
      getProjectItem: async () => ({ owner: { projectV2: { items: { nodes: [{ id: "item", content: { number: 42, repository: { nameWithOwner: "zbrg/saf" } }, fieldValueByName: { name: "Ready" } }] } } } })
    });
    await expect(adapter.getIssue("zbrg/saf", 42)).resolves.toMatchObject({ ok: true, data: { number: 42, comments: [{ body: "comment" }] } });
    await expect(adapter.getProjectItem({ owner: "zbrg", number: 5 }, "zbrg/saf", 42)).resolves.toMatchObject({ ok: true, data: { id: "item", status: "Ready" } });
  });

  it("reads PR, checks and the latest acceptance status", async () => {
    const base = transport();
    const adapter = new DefaultGitHubAdapter({
      ...base,
      getPullRequest: async () => ({ number: 51, state: "open", draft: true, merged_at: null, html_url: "url", head: { sha: "a".repeat(40), ref: "feat/42" } }),
      getIssueComments: async () => [],
      getChecks: async () => ({ total_count: 2, check_runs: [{ name: "test", status: "completed", conclusion: "success" }, { name: "lint", status: "in_progress", conclusion: null }] }),
      getCommitStatuses: async () => [
        { sha: "a".repeat(40), context: "saf/human-acceptance", state: "failure" },
        { sha: "a".repeat(40), context: "saf/human-acceptance", state: "success" }
      ]
    });
    await expect(adapter.getPullRequest("zbrg/saf", 51)).resolves.toMatchObject({ ok: true, data: { branch: "feat/42", comments: [] } });
    await expect(adapter.getChecks("zbrg/saf", "a".repeat(40))).resolves.toMatchObject({ ok: true, data: { state: "pending", total: 2 } });
    await expect(adapter.getCommitStatus("zbrg/saf", "a".repeat(40), "saf/human-acceptance")).resolves.toMatchObject({ ok: true, data: { present: false } });
  });

  it("updates Project Status and upserts Issue comments through typed mutations", async () => {
    const updateProjectItemStatus = vi.fn(async () => ({}));
    const createIssueComment = vi.fn(async () => ({ id: 11 }));
    const updateIssueComment = vi.fn(async () => ({ id: 11 }));
    const adapter = new DefaultGitHubAdapter({ ...transport(), updateProjectItemStatus, createIssueComment, updateIssueComment });
    await expect(adapter.setProjectItemStatus({ owner: "zbrg", number: 5 }, "zbrg/saf", "item-1", "Shaping")).resolves.toMatchObject({ ok: true });
    expect(updateProjectItemStatus).toHaveBeenCalledWith("PVT_1", "item-1", "status-field", "option-1");
    await expect(adapter.createIssueComment("zbrg/saf", 42, "body")).resolves.toMatchObject({ ok: true, data: { id: 11 } });
    await expect(adapter.updateIssueComment("zbrg/saf", 11, "changed")).resolves.toMatchObject({ ok: true, data: { id: 11 } });
  });

  it("creates one Draft PR for a branch and adds it to the Project", async () => {
    const createPullRequest = vi.fn(async () => pullRequestResponse());
    const addProjectItem = vi.fn(async () => ({}));
    const adapter = new DefaultGitHubAdapter({ ...transport(), createPullRequest, addProjectItem });
    const result = await adapter.createOrUpdateDraftPullRequest("zbrg/saf", { title: "Build", body: "Evidence", branch: "saf/42", base: "master" });
    expect(result).toMatchObject({ ok: true, data: { number: 7, draft: true, nodeId: "PR_node" } });
    expect(createPullRequest).toHaveBeenCalledOnce();
    await expect(adapter.addPullRequestToProject({ owner: "zbrg", number: 5 }, "zbrg/saf", "PR_node")).resolves.toMatchObject({ ok: true });
    expect(addProjectItem).toHaveBeenCalledWith("PVT_1", "PR_node");
  });

  it("updates the existing Draft PR instead of creating a duplicate", async () => {
    const updatePullRequest = vi.fn(async () => pullRequestResponse());
    const createPullRequest = vi.fn(async () => pullRequestResponse());
    const adapter = new DefaultGitHubAdapter({ ...transport(), listPullRequests: async () => [pullRequestResponse()], updatePullRequest, createPullRequest });
    await expect(adapter.createOrUpdateDraftPullRequest("zbrg/saf", { title: "Build", body: "Evidence", branch: "saf/42", base: "master" })).resolves.toMatchObject({ ok: true });
    expect(updatePullRequest).toHaveBeenCalledWith("zbrg", "saf", 7, { title: "Build", body: "Evidence" });
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("publishes commit status through the typed adapter", async () => {
    const createCommitStatus = vi.fn(async () => ({}));
    const adapter = new DefaultGitHubAdapter({ ...transport(), createCommitStatus });
    await expect(adapter.createCommitStatus("zbrg/saf", "a".repeat(40), "saf/human-acceptance", "success", "Accepted")).resolves.toMatchObject({ ok: true });
    expect(createCommitStatus).toHaveBeenCalledWith("zbrg", "saf", "a".repeat(40), "saf/human-acceptance", "success", "Accepted");
  });
});

function pullRequestResponse() {
  return { number: 7, node_id: "PR_node", state: "open", draft: true, merged_at: null, html_url: "url", head: { sha: "a".repeat(40), ref: "saf/42" } };
}

function transport(overrides: { repository?: string; fields?: unknown[]; error?: Error; repositoryResponse?: unknown } = {}): GitHubTransport {
  return {
    getRepository: async () => {
      if (overrides.error) throw overrides.error;
      return overrides.repositoryResponse ?? { full_name: "zbrg/saf", has_issues: true, default_branch: "master" };
    },
    getProject: async () => {
      if (overrides.error) throw overrides.error;
      return projectResponse(overrides);
    },
    getIssue: async () => ({}),
    getIssueComments: async () => [],
    getProjectItem: async () => ({}),
    getPullRequest: async () => ({}),
    getPullRequestFiles: async () => [],
    getChecks: async () => ({}),
    getCommitStatuses: async () => [],
    updateProjectItemStatus: async () => ({}),
    createIssueComment: async () => ({ id: 1 }),
    updateIssueComment: async () => ({ id: 1 }),
    listPullRequests: async () => [],
    createPullRequest: async () => ({}),
    updatePullRequest: async () => ({}),
    addProjectItem: async () => ({}),
    createCommitStatus: async () => ({})
  };
}

function projectResponse(overrides: { repository?: string; fields?: unknown[] } = {}): unknown {
  const fields = overrides.fields ?? [{ id: "status-field", name: "Status", options: requiredProjectStatuses.map((name, index) => ({ id: `option-${index}`, name })) }];
  return { owner: { projectV2: { id: "PVT_1", title: "SAF", fields: { nodes: fields }, items: { nodes: [
    { content: { repository: { nameWithOwner: "zbrg/saf" } } },
    { content: { repository: { nameWithOwner: overrides.repository ?? "zbrg/saf" } } }
  ] } } } };
}
