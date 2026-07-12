import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createAuthenticatedGitHubAdapter } from "../src/github/auth.js";
import type { GitHubAdapter } from "../src/github/types.js";
import { writeInitialization } from "../src/init/filesystem.js";
import { initializeRepository } from "../src/init/init.js";
import { runCommand } from "../src/runner/command-runner.js";

const executeFile = promisify(execFile);

describe("saf init process integration", () => {
  it("uses argv-based git, gh and tool executables", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-init-process-"));
    const bin = join(root, "fake-bin");
    await mkdir(bin);
    await executeFile("git", ["init", "-q", root]);
    await executeFile("git", ["-C", root, "remote", "add", "origin", "git@github.com:zbrg/saf.git"]);
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { check: "vitest run" } }));
    await fakeExecutable(join(bin, "gh"), ghScript());
    for (const tool of ["claude", "ralphex", "codex", "revdiff"]) await fakeExecutable(join(bin, tool), "#!/bin/sh\nprintf '%s\\n' '1.0.0'\n");

    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    try {
      const result = await initializeRepository(
        { project: "zbrg/5", validationCommands: ["pnpm check"], rebind: false, dryRun: false, yes: true, interactive: false, cwd: root },
        { execute: runCommand, github: (cwd, execute) => createAuthenticatedGitHubAdapter(cwd, execute, () => fakeAdapter), confirm: async () => false, write: writeInitialization }
      );
      expect(result).toMatchObject({ ok: true, data: { repository: "zbrg/saf", project: "zbrg/5" } });
      expect(await readFile(join(root, ".saf/config.yaml"), "utf8")).toContain("repository: zbrg/saf");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

async function fakeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o755 });
}

function ghScript(): string {
  return `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "token" ]; then printf '%s' 'fake-token'; exit 0; fi
exit 1
`;
}

const fakeAdapter: GitHubAdapter = {
  getRepository: async () => ({ ok: true, data: { repository: "zbrg/saf", defaultBranch: "master" }, diagnostics: [] }),
  getProject: async () => ({ ok: true, data: { id: "PVT_1", title: "SAF", statusFieldId: "status", statusOptions: [] }, diagnostics: [] }),
  getIssue: async () => ({ ok: true, data: { number: 1, title: "Issue", state: "open", body: "", comments: [] }, diagnostics: [] }),
  getProjectItem: async () => ({ ok: true, data: { id: "item", status: "Backlog" }, diagnostics: [] }),
  getPullRequest: async () => ({ ok: true, data: { number: 1, state: "open", draft: true, merged: false, headSha: "a", branch: "branch", url: "url", comments: [] }, diagnostics: [] }),
  getChecks: async () => ({ ok: true, data: { state: "missing", total: 0, failing: [] }, diagnostics: [] }),
  getCommitStatus: async () => ({ ok: true, data: { present: false, sha: "a" }, diagnostics: [] }),
  setProjectItemStatus: async () => ({ ok: true, data: undefined, diagnostics: [] }),
  createIssueComment: async () => ({ ok: true, data: { id: 1 }, diagnostics: [] }),
  updateIssueComment: async () => ({ ok: true, data: { id: 1 }, diagnostics: [] }),
  findPullRequestByBranch: async () => ({ ok: true, data: null, diagnostics: [] }),
  createOrUpdateDraftPullRequest: async () => ({ ok: false, diagnostics: [] }),
  addPullRequestToProject: async () => ({ ok: true, data: undefined, diagnostics: [] })
};
