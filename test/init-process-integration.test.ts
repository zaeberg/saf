import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { requiredProjectStatuses } from "../src/github/project.js";
import { initializeRepository } from "../src/init/init.js";

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
      const result = await initializeRepository({ project: "zbrg/5", validationCommands: ["pnpm check"], rebind: false, dryRun: false, yes: true, interactive: false, cwd: root });
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
  const project = JSON.stringify({ data: { owner: { projectV2: { id: "PVT_1", title: "SAF", fields: { nodes: [{ name: "Status", options: requiredProjectStatuses.map((name, index) => ({ id: `${index}`, name })) }] }, items: { nodes: [{ content: { repository: { nameWithOwner: "zbrg/saf" } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
  const repository = JSON.stringify({ nameWithOwner: "zbrg/saf", hasIssuesEnabled: true, defaultBranchRef: { name: "master" } });
  return `#!/bin/sh
if [ "$1" = "auth" ]; then exit 0; fi
if [ "$1" = "repo" ]; then printf '%s' '${repository}'; exit 0; fi
if [ "$1" = "api" ]; then printf '%s' '${project}'; exit 0; fi
exit 1
`;
}
