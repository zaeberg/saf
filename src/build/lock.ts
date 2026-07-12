import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { failure, success, type CommandResult } from "../contracts/result.js";

export interface RunLock { path: string; release(): Promise<void>; }

export async function acquireRunLock(path: string, issue: number): Promise<CommandResult<RunLock>> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, issue, startedAt: new Date().toISOString() }));
    await handle.close();
  } catch (error: unknown) {
    if (!isExists(error)) throw error;
    const stale = await isStale(path);
    if (!stale) return failure([{ code: "ACTIVE_RUN_EXISTS", severity: "error", message: "Another SAF implementation run is active in this repository.", remediation: "Wait for it to finish or inspect the runtime lock." }]);
    await unlink(path);
    return acquireRunLock(path, issue);
  }
  return success({ path, release: async () => { try { await unlink(path); } catch { /* already removed */ } } });
}

async function isStale(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (typeof value.pid !== "number") return true;
    try { process.kill(value.pid, 0); return false; }
    catch { return true; }
  } catch { return true; }
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
