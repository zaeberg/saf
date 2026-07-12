import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/runner/command-runner.js";

describe("runCommand", () => {
  it("passes argv without shell interpolation", async () => {
    const argument = "hello; echo unsafe";
    const result = await runCommand({ command: "/usr/bin/printf", args: ["%s", argument] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stdout).toBe(argument);
  });

  it("does not start a dry-run command", async () => {
    const result = await runCommand({ command: "definitely-not-a-command", args: ["x"], dryRun: true });
    expect(result).toMatchObject({ ok: true, data: { dryRun: true, exitCode: 0 } });
  });

  it("redacts secrets from captured and streamed output", async () => {
    const stream = vi.fn();
    const secret = "top-secret-value";
    const result = await runCommand({
      command: "/usr/bin/printf",
      args: ["%s", secret],
      secrets: [secret],
      onStdout: stream
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.stdout).toBe("[REDACTED]");
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(stream).toHaveBeenCalledWith("[REDACTED]");
  });

  it("does not leak a secret split across stream chunks", async () => {
    const chunks: string[] = [];
    const secret = "split-secret";
    const result = await runCommand({
      command: "/bin/sh",
      args: ["-c", "printf split-; sleep 0.05; printf secret"],
      secrets: [secret],
      onStdout: (chunk) => chunks.push(chunk)
    });
    expect(result.ok).toBe(true);
    expect(chunks.join("")).toBe("[REDACTED]");
    expect(chunks.join("")).not.toContain(secret);
  });

  it("supports cancellation", async () => {
    const controller = new AbortController();
    const execution = runCommand({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], signal: controller.signal });
    controller.abort();
    await expect(execution).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "COMMAND_CANCELLED" }] });
  });
});
