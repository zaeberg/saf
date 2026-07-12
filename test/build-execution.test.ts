import { describe, expect, it, vi } from "vitest";
import { failure, success } from "../src/contracts/result.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { runRalphex, runRalphexReview, runValidation } from "../src/build/execution.js";

describe("build execution", () => {
  it("passes the approved plan to Ralphex in native Codex mode", async () => {
    const execute = vi.fn(async (invocation: CommandInvocation) => ok(invocation));
    const result = await runRalphex("/repo", "/repo/docs/plans/plan.md", "saf/42-abc", { tasksOnly: true, taskModel: "gpt-5.4:high" }, execute);
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith({
      command: "ralphex",
      args: ["--codex", "--branch=saf/42-abc", "--tasks-only", "--task-model=gpt-5.4:high", "/repo/docs/plans/plan.md"],
      cwd: "/repo",
      stdio: "inherit"
    });
  });

  it("parses validation commands without a shell and preserves quoted arguments", async () => {
    const execute = vi.fn(async (invocation: CommandInvocation) => ok(invocation));
    const result = await runValidation("/repo", ["pnpm test -- --runInBand", "node -e \"console.log('safe value')\""], execute);
    expect(result).toMatchObject({ ok: true, data: [
      { command: "pnpm test -- --runInBand", exitCode: 0 },
      { command: "node -e \"console.log('safe value')\"", exitCode: 0 }
    ] });
    expect(execute.mock.calls.map(([invocation]) => invocation)).toEqual([
      { command: "pnpm", args: ["test", "--", "--runInBand"], cwd: "/repo", stdio: "inherit" },
      { command: "node", args: ["-e", "console.log('safe value')"], cwd: "/repo", stdio: "inherit" }
    ]);
  });

  it("stops validation at the first failed command", async () => {
    const execute = vi.fn(async (invocation: CommandInvocation) => invocation.args?.[0] === "bad"
      ? failure([{ code: "COMMAND_FAILED", severity: "error", message: "failed", remediation: "fix" }])
      : ok(invocation));
    const result = await runValidation("/repo", ["pnpm bad", "pnpm never"], execute);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "VALIDATION_FAILED" }] });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves cancellation from Ralphex", async () => {
    const execute = vi.fn(async () => failure<CommandExecution>([{ code: "COMMAND_CANCELLED", severity: "error", message: "cancelled", remediation: "retry" }]));
    const result = await runRalphex("/repo", "/repo/plan.md", "saf/42-abc", { tasksOnly: false }, execute);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "COMMAND_CANCELLED" }] });
  });

  it("runs the standalone Ralphex review pipeline", async () => {
    const execute = vi.fn(async (invocation: CommandInvocation) => ok(invocation));
    await expect(runRalphexReview("/repo", "/repo/docs/plans/plan.md", { baseRef: "master", externalReviewTool: "claude", reviewModel: "gpt-5.4:high" }, execute)).resolves.toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledWith({ command: "ralphex", args: ["--review", "--external-review-tool=none", "--base-ref=master", "--review-model=gpt-5.4:high", "/repo/docs/plans/plan.md"], cwd: "/repo", stdio: "inherit" });
  });
});

function ok(invocation: CommandInvocation) {
  return success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode: 0, stdout: "", stderr: "", dryRun: false });
}
