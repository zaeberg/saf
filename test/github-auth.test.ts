import { describe, expect, it, vi } from "vitest";
import { failure, success } from "../src/contracts/result.js";
import { createAuthenticatedGitHubAdapter } from "../src/github/auth.js";
import type { GitHubAdapter } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";

const fakeAdapter: GitHubAdapter = {
  getRepository: async () => failure([]),
  getProject: async () => failure([]),
  getIssue: async () => failure([]),
  getProjectItem: async () => failure([]),
  getPullRequest: async () => failure([]),
  getChecks: async () => failure([]),
  getCommitStatus: async () => failure([])
};

describe("GitHub credential boundary", () => {
  it("passes an in-memory gh token to the factory without exposing it", async () => {
    const secret = "github-secret-token";
    const factory = vi.fn(() => fakeAdapter);
    const execute = async (invocation: CommandInvocation) => success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode: 0, stdout: "", stderr: "", dryRun: false });
    const result = await createAuthenticatedGitHubAdapter("/repo", execute, factory, async () => `${secret}\n`);
    expect(result.ok).toBe(true);
    expect(factory).toHaveBeenCalledWith(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("maps missing authentication without requesting a token", async () => {
    const execute = vi.fn(async () => failure<CommandExecution>([{ code: "COMMAND_FAILED", severity: "error", message: "raw auth error", remediation: "retry" }]));
    const result = await createAuthenticatedGitHubAdapter("/repo", execute, () => fakeAdapter);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "GITHUB_AUTH_MISSING" }] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("raw auth error");
  });
});
