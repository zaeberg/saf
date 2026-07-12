import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireRunLock } from "../src/build/lock.js";

describe("build lock", () => {
  it("rejects a concurrent run and permits a run after release", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-lock-"));
    const path = join(root, "build.lock");
    const first = await acquireRunLock(path, 42);
    expect(first.ok).toBe(true);
    const second = await acquireRunLock(path, 43);
    expect(second).toMatchObject({ ok: false, diagnostics: [{ code: "ACTIVE_RUN_EXISTS" }] });
    if (first.ok) await first.data.release();
    const third = await acquireRunLock(path, 43);
    expect(third.ok).toBe(true);
    if (third.ok) await third.data.release();
  });

  it("replaces a stale lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "saf-lock-"));
    const path = join(root, "build.lock");
    await writeFile(path, JSON.stringify({ pid: 999_999_999, issue: 1 }));
    const result = await acquireRunLock(path, 42);
    expect(result.ok).toBe(true);
    if (result.ok) await result.data.release();
  });
});
