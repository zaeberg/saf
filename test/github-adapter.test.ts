import { describe, expect, it } from "vitest";
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
});

function transport(overrides: { repository?: string; fields?: unknown[]; error?: Error; repositoryResponse?: unknown } = {}): GitHubTransport {
  return {
    getRepository: async () => {
      if (overrides.error) throw overrides.error;
      return overrides.repositoryResponse ?? { full_name: "zbrg/saf", has_issues: true, default_branch: "master" };
    },
    getProject: async () => {
      if (overrides.error) throw overrides.error;
      return projectResponse(overrides);
    }
  };
}

function projectResponse(overrides: { repository?: string; fields?: unknown[] } = {}): unknown {
  const fields = overrides.fields ?? [{ name: "Status", options: requiredProjectStatuses.map((name, index) => ({ id: `option-${index}`, name })) }];
  return { owner: { projectV2: { id: "PVT_1", title: "SAF", fields: { nodes: fields }, items: { nodes: [
    { content: { repository: { nameWithOwner: "zbrg/saf" } } },
    { content: { repository: { nameWithOwner: overrides.repository ?? "zbrg/saf" } } }
  ] } } } };
}
