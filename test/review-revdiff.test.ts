import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { success } from "../src/contracts/result.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { parseAnnotations, reviewDiff } from "../src/review/revdiff.js";

describe("revdiff annotation severity", () => {
  it("uses explicit prefixes and defaults untagged findings to blocking", () => {
    expect(parseAnnotations("# Annotations\n\n## src/a.ts:10 (+)\n\n[non-blocking] Rename this later.\n\n## src/b.ts:3 (-)\n\n[blocking] This breaks auth.\n\n## src/c.ts (file-level)\n\nUnclear behavior.\n")).toEqual([
      { location: "src/a.ts:10 (+)", message: "Rename this later.", severity: "non-blocking" },
      { location: "src/b.ts:3 (-)", message: "This breaks auth.", severity: "blocking" },
      { location: "src/c.ts (file-level)", message: "Unclear behavior.", severity: "blocking" }
    ]);
  });

  it("opens the exact branch diff and reads revdiff markdown output", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-revdiff-"));
    const output = join(root, "annotations.md");
    await writeFile(output, "# Annotations\n\n## src/a.ts:1 (+)\n\n[non-blocking] Consider a rename.\n");
    const execute = vi.fn(async (invocation: CommandInvocation) => success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode: 10, stdout: "", stderr: "", dryRun: false }));
    const result = await reviewDiff(root, "master", "saf/42", join(root, "packet.json"), output, execute);
    expect(result).toMatchObject({ ok: true, data: { annotations: [{ severity: "non-blocking" }] } });
    expect(execute).toHaveBeenCalledWith({ command: "revdiff", args: ["master", "saf/42", `--output=${output}`, "--exit-code-on-annotations", `--description-file=${join(root, "packet.json")}`], cwd: root, stdio: "inherit", acceptedExitCodes: [0, 10] });
  });
});
