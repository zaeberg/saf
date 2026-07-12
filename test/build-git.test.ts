import { describe, expect, it, vi } from "vitest";
import { success } from "../src/contracts/result.js";
import { ensureRunBranch } from "../src/build/git.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";

describe("build branch recovery", () => {
  it("switches to an existing local run branch", async () => {
    const execute = executor("master");
    await expect(ensureRunBranch("/repo", "saf/42", ["master", "saf/42"], [], execute)).resolves.toMatchObject({ ok: true });
    expect(execute.mock.calls.map(([call]) => call.args)).toEqual([["branch", "--show-current"], ["switch", "saf/42"]]);
  });

  it("restores a remote-only run branch without force or cleanup", async () => {
    const execute = executor("master");
    await expect(ensureRunBranch("/repo", "saf/42", ["master"], ["saf/42"], execute)).resolves.toMatchObject({ ok: true });
    expect(execute.mock.calls.map(([call]) => call.args)).toEqual([
      ["branch", "--show-current"],
      ["fetch", "origin"],
      ["switch", "--track", "-c", "saf/42", "origin/saf/42"]
    ]);
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/--force|reset|clean/);
  });
});

function executor(current: string) {
  return vi.fn(async (invocation: CommandInvocation) => success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode: 0, stdout: invocation.args?.[0] === "branch" ? current : "", stderr: "", dryRun: false }));
}
