import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAndLintPlan } from "../src/shape/plan.js";

describe("plan lint", () => {
  it("accepts an executable plan", async () => {
    const path = await fixture(validPlan);
    await expect(loadAndLintPlan(path)).resolves.toMatchObject({ ok: true, data: { path } });
  });

  it.each([
    ["missing Validation", validPlan.replace("## Validation", "## Notes")],
    ["empty Tasks", validPlan.replace("- Implement the required behavior.", "No tasks yet.")],
    ["placeholder", validPlan.replace("focused outcome", "TODO")]
  ])("rejects %s", async (_name, content) => {
    const result = await loadAndLintPlan(await fixture(content));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "PLAN_INVALID" }] });
  });
});

async function fixture(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "saf-plan-"));
  const path = join(directory, "plan.md");
  await writeFile(path, content);
  return path;
}

const validPlan = `# Plan

## Goal

Deliver one focused outcome with enough detail for deterministic implementation and review.

## Tasks

- Implement the required behavior.

## Acceptance criteria

- The observable result matches the documented contract.

## Validation

\`\`\`bash
pnpm check
\`\`\`
`;
