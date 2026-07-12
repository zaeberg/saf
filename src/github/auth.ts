import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";
import { readCommandSecret } from "../runner/secret-reader.js";
import { DefaultGitHubAdapter } from "./adapter.js";
import { createOctokitTransport } from "./transport.js";
import type { GitHubAdapter } from "./types.js";

export type AuthExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;
export type GitHubAdapterFactory = (token: string) => GitHubAdapter;
export type SecretReader = typeof readCommandSecret;

export async function createAuthenticatedGitHubAdapter(cwd: string, execute: AuthExecutor = runCommand, factory: GitHubAdapterFactory = defaultFactory, readSecret: SecretReader = readCommandSecret): Promise<CommandResult<GitHubAdapter>> {
  const auth = await execute({ command: "gh", args: ["auth", "status"], cwd });
  if (!auth.ok) return failure([{ code: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "TOOL_NOT_FOUND" : "GITHUB_AUTH_MISSING", severity: "error", message: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "Required tool gh was not found." : "GitHub CLI authentication is missing or invalid.", remediation: auth.diagnostics[0]?.code === "TOOL_NOT_FOUND" ? "Install gh and retry." : "Run gh auth login and retry." }]);
  try {
    const token = (await readSecret({ command: "gh", args: ["auth", "token"], cwd })).trim();
    if (token.length === 0) return failure([{ code: "GITHUB_AUTH_MISSING", severity: "error", message: "GitHub CLI did not provide an authentication token.", remediation: "Run gh auth login and retry." }]);
    return success(factory(token));
  } catch {
    return failure([{ code: "GITHUB_AUTH_MISSING", severity: "error", message: "GitHub client initialization failed.", remediation: "Refresh gh authentication and retry." }]);
  }
}

function defaultFactory(token: string): GitHubAdapter {
  return new DefaultGitHubAdapter(createOctokitTransport(token));
}
