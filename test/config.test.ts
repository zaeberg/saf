import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";

const validConfig = `
version: 1
github:
  repository: zbrg/example
  project:
    owner: zbrg
    number: 5
repository:
  defaultBranch: main
documentation:
  plansDirectory: docs/plans
planning:
  adapter: claude-glm
execution:
  adapter: ralphex-codex
  maxConcurrentRuns: 1
  tasksOnly: false
review:
  adapter: ralphex-codex
  externalReviewTool: none
validation:
  commands:
    - pnpm check
`;

describe("loadConfig", () => {
  it("loads schema v1", async () => {
    const path = await fixture(validConfig);
    const result = await loadConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.github.project.number).toBe(5);
  });

  it("reports the invalid field path", async () => {
    const path = await fixture(validConfig.replace("number: 5", "number: nope"));
    const result = await loadConfig(path);
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "CONFIG_INVALID", path: "github.project.number" })]
    });
  });

  it("rejects unknown fields", async () => {
    const path = await fixture(`${validConfig}\nunknown: true\n`);
    const result = await loadConfig(path);
    expect(result.ok).toBe(false);
  });

  it("migrates the legacy revdiff adapter to Ralphex review defaults", async () => {
    const result = await loadConfig(await fixture(validConfig.replace("adapter: ralphex-codex\n  externalReviewTool: none", "adapter: revdiff")));
    expect(result).toMatchObject({ ok: true, data: { review: { adapter: "ralphex-codex", externalReviewTool: "none" } } });
  });
});

async function fixture(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "saf-config-"));
  const path = join(directory, "config.yaml");
  await writeFile(path, contents);
  return path;
}
