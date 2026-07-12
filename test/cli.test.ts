import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli-program.js";

describe("CLI shell", () => {
  it.each([["--help"], ["--version"]])("accepts %s", async (flag) => {
    let stdout = "";
    const result = await runCli([flag], { stdout: (text) => { stdout += text; }, stderr: () => undefined });
    expect(result.exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it("rejects unknown options", async () => {
    const result = await runCli(["--unknown"], { stdout: () => undefined, stderr: () => undefined });
    expect(result.exitCode).toBe(2);
  });

  it("maps init diagnostics to JSON and stable exit codes", async () => {
    let stderr = "";
    const result = await runCli(["init", "--project", "invalid", "--json"], { stdout: () => undefined, stderr: (text) => { stderr += text; } });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_ARGUMENT" }] });
  });

  it("rejects invalid status Issue numbers before external reads", async () => {
    let stderr = "";
    const result = await runCli(["status", "nope", "--json"], { stdout: () => undefined, stderr: (text) => { stderr += text; } });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_ARGUMENT" }] });
  });

  it("rejects invalid shape Issue numbers before external reads", async () => {
    let stderr = "";
    const result = await runCli(["shape", "nope", "--plan", "plan.md", "--json"], { stdout: () => undefined, stderr: (text) => { stderr += text; } });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_ARGUMENT" }] });
  });

  it("rejects invalid build Issue numbers before external reads", async () => {
    let stderr = "";
    const result = await runCli(["build", "nope", "--json"], { stdout: () => undefined, stderr: (text) => { stderr += text; } });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, diagnostics: [{ code: "INVALID_ARGUMENT" }] });
  });
});
