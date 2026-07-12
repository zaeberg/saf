import { describe, expect, it } from "vitest";
import { loadProject, requiredProjectStatuses } from "../src/github/project.js";
import { failure, success } from "../src/contracts/result.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";

describe("GitHub Project contract", () => {
  it("accepts a repository-scoped Project", async () => {
    const result = await loadProject({ owner: "zbrg", number: 5 }, "zbrg/saf", "/repo", executor(projectResponse()));
    expect(result).toMatchObject({ ok: true, data: { id: "PVT_1", title: "SAF" } });
  });

  it("rejects foreign repository items", async () => {
    const result = await loadProject({ owner: "zbrg", number: 5 }, "zbrg/saf", "/repo", executor(projectResponse({ repository: "other/repo" })));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "PROJECT_REPOSITORY_DRIFT" }] });
  });

  it("reports a missing Status field", async () => {
    const result = await loadProject({ owner: "zbrg", number: 5 }, "zbrg/saf", "/repo", executor(projectResponse({ fields: [] })));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "PROJECT_STATUS_FIELD_MISSING" }] });
  });

  it("maps inaccessible Projects", async () => {
    const execute = async () => failure<CommandExecution>([{ code: "COMMAND_FAILED", severity: "error", message: "denied", remediation: "retry" }]);
    const result = await loadProject({ owner: "zbrg", number: 5 }, "zbrg/saf", "/repo", execute);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "PROJECT_ACCESS_DENIED" }] });
  });
});

function executor(response: string) {
  return async (invocation: CommandInvocation) => success<CommandExecution>({ command: invocation.command, args: invocation.args ?? [], exitCode: 0, stdout: response, stderr: "", dryRun: false });
}

function projectResponse(overrides: { repository?: string; fields?: unknown[] } = {}): string {
  const fields = overrides.fields ?? [{ name: "Status", options: requiredProjectStatuses.map((name, index) => ({ id: `option-${index}`, name })) }];
  return JSON.stringify({ data: { owner: { projectV2: { id: "PVT_1", title: "SAF", fields: { nodes: fields }, items: { nodes: [{ content: { repository: { nameWithOwner: overrides.repository ?? "zbrg/saf" } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
}
