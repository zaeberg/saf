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
});
