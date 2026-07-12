import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { success } from "../src/contracts/result.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { runPlanner } from "../src/shape/planner.js";

describe("shape external adapters", () => {
  it("runs an interactive planner and discovers one changed plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-planner-"));
    const plans = join(root, "docs/plans");
    await mkdir(plans, { recursive: true });
    const execute = vi.fn(async (invocation: CommandInvocation) => {
      await writeFile(join(plans, "issue-42.md"), "# plan");
      return execution(invocation, 0);
    });
    await expect(runPlanner(root, "docs/plans", { number: 42, title: "Fix recovery", state: "open", body: "Expected outcome", comments: [] }, execute)).resolves.toMatchObject({ ok: true, data: join(plans, "issue-42.md") });
    const prompt = execute.mock.calls[0]![0].args![0]!;
    expect(prompt).toContain("GitHub Issue #42");
    expect(prompt).toContain("Expected outcome");
    expect(prompt).toContain("read AGENTS.md");
    expect(prompt).toContain("/planning:make");
    expect(prompt).not.toContain("PROJECT.md");
    expect(prompt).not.toContain(".saf/config.yaml");
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ command: "claude", stdio: "inherit" }));
  });

});

function execution(invocation: CommandInvocation, exitCode: number) {
  return success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode, stdout: "", stderr: "", dryRun: false });
}
