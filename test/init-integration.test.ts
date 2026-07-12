import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { success } from "../src/contracts/result.js";
import type { GitHubAdapter } from "../src/github/types.js";
import { initializeRepository } from "../src/init/init.js";
import { writeInitialization } from "../src/init/filesystem.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";

describe("saf init integration", () => {
  it("writes a valid config and is idempotent", async () => {
    const root = await repositoryFixture();
    const execute = fakeExecutor(root);
    const write = vi.fn(writeInitialization);
    const options = { project: "zbrg/5", validationCommands: ["pnpm check"], rebind: false, dryRun: false, yes: true, interactive: false, cwd: root };
    const first = await initializeRepository(options, { execute, github: fakeGitHubProvider, confirm: async () => false, write });
    expect(first).toMatchObject({ ok: true, data: { changed: true, repository: "zbrg/saf", validationCommands: ["pnpm check"] } });
    const configAfterFirstRun = await readFile(join(root, ".saf/config.yaml"), "utf8");
    const ignoreAfterFirstRun = await readFile(join(root, ".gitignore"), "utf8");
    const second = await initializeRepository(options, { execute, github: fakeGitHubProvider, confirm: async () => false, write });
    expect(second).toMatchObject({ ok: true, data: { changed: false } });
    expect(await readFile(join(root, ".saf/config.yaml"), "utf8")).toBe(configAfterFirstRun);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(ignoreAfterFirstRun);
    expect(write).toHaveBeenCalledTimes(1);
    expect(ignoreAfterFirstRun).toContain(".saf/runtime/");
    expect(configAfterFirstRun).not.toMatch(/token|credential|secret/i);
  });

  it("does not write during dry-run", async () => {
    const root = await repositoryFixture();
    const write = vi.fn(writeInitialization);
    const result = await initializeRepository({ project: "zbrg/5", validationCommands: ["pnpm test"], rebind: false, dryRun: true, yes: false, interactive: false, cwd: root }, { execute: fakeExecutor(root), github: fakeGitHubProvider, confirm: async () => false, write });
    expect(result).toMatchObject({ ok: true, data: { dryRun: true, changed: true } });
    expect(write).not.toHaveBeenCalled();
  });

  it("requires --rebind and explicit confirmation", async () => {
    const root = await repositoryFixture();
    const dependencies = { execute: fakeExecutor(root), github: fakeGitHubProvider, confirm: async () => false, write: writeInitialization };
    const base = { validationCommands: ["pnpm check"], dryRun: false, yes: true, interactive: false, cwd: root };
    await initializeRepository({ ...base, project: "zbrg/5", rebind: false }, dependencies);
    const blocked = await initializeRepository({ ...base, project: "zbrg/6", rebind: false }, dependencies);
    expect(blocked).toMatchObject({ ok: false, diagnostics: [{ code: "REBIND_REQUIRED" }] });
    const unconfirmed = await initializeRepository({ ...base, project: "zbrg/6", rebind: true, yes: false }, dependencies);
    expect(unconfirmed).toMatchObject({ ok: false, diagnostics: [{ code: "CONFIRMATION_REQUIRED" }] });
    const rebound = await initializeRepository({ ...base, project: "zbrg/6", rebind: true }, dependencies);
    expect(rebound).toMatchObject({ ok: true, data: { project: "zbrg/6", changed: true } });
  });

  it("requires explicit validation commands when non-interactive", async () => {
    const root = await repositoryFixture();
    const result = await initializeRepository({ project: "zbrg/5", validationCommands: [], rebind: false, dryRun: false, yes: true, interactive: false, cwd: root }, { execute: fakeExecutor(root), github: fakeGitHubProvider, confirm: async () => false, write: writeInitialization });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "VALIDATION_COMMANDS_REQUIRED" }] });
  });
});

async function repositoryFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "saf-init-"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { check: "test" } }));
  return root;
}

function fakeExecutor(root: string) {
  return async (invocation: CommandInvocation) => {
    const args = invocation.args ?? [];
    let stdout = "1.0.0";
    if (invocation.command === "git" && args[0] === "rev-parse") stdout = root;
    else if (invocation.command === "git" && args[0] === "remote") stdout = "git@github.com:zbrg/saf.git";
    return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
  };
}

async function fakeGitHubProvider() {
  return success<GitHubAdapter>({
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
    getProject: async () => success({ id: "PVT_1", title: "SAF", statusOptions: [] }),
    getIssue: async () => success({ number: 1, title: "Issue", state: "open", body: "", comments: [] }),
    getProjectItem: async () => success({ id: "item", status: "Backlog" }),
    getPullRequest: async () => success({ number: 1, state: "open", draft: true, merged: false, headSha: "a", branch: "branch", url: "url", comments: [] }),
    getChecks: async () => success({ state: "missing", total: 0, failing: [] }),
    getCommitStatus: async () => success({ present: false, sha: "a" })
  });
}
