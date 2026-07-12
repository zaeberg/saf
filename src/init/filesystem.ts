import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import type { SafConfigV1 } from "../config/schema.js";
import { mergeGitignore } from "../git/gitignore.js";

const ignoredEntries = [".saf/runtime/", ".saf/config.local.yaml"] as const;

export async function writeInitialization(root: string, config: SafConfigV1): Promise<void> {
  const safDirectory = join(root, ".saf");
  const configPath = join(safDirectory, "config.yaml");
  const temporaryPath = join(safDirectory, `.config.yaml.${process.pid}.tmp`);
  await mkdir(join(safDirectory, "runtime"), { recursive: true });
  await writeFile(temporaryPath, stringify(config), { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, configPath);

  const gitignorePath = join(root, ".gitignore");
  let gitignore = "";
  try { gitignore = await readFile(gitignorePath, "utf8"); }
  catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const merged = mergeGitignore(gitignore, ignoredEntries);
  if (merged !== gitignore) {
    await mkdir(dirname(gitignorePath), { recursive: true });
    await writeFile(gitignorePath, merged, "utf8");
  }
}
