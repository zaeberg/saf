import { describe, expect, it } from "vitest";
import { mergeGitignore } from "../src/git/gitignore.js";
import { parseGitHubRemote } from "../src/git/remote.js";
import { parseProjectReference } from "../src/init/project-reference.js";

describe("init contracts", () => {
  it.each([
    ["git@github.com:zbrg/saf.git", "zbrg/saf"],
    ["ssh://git@github.com/zbrg/saf.git", "zbrg/saf"],
    ["https://github.com/zbrg/saf.git", "zbrg/saf"]
  ])("parses GitHub remote %s", (remote, expected) => {
    expect(parseGitHubRemote(remote)).toMatchObject({ ok: true, data: expected });
  });

  it("rejects a non-GitHub remote", () => {
    expect(parseGitHubRemote("git@example.com:zbrg/saf.git")).toMatchObject({ ok: false });
  });

  it("parses an explicit Project reference", () => {
    expect(parseProjectReference("zbrg/5")).toEqual({ ok: true, data: { owner: "zbrg", number: 5 }, diagnostics: [] });
    expect(parseProjectReference("zbrg/0")).toMatchObject({ ok: false });
  });

  it("merges gitignore entries without duplicates", () => {
    const once = mergeGitignore("dist/\n.saf/runtime/\n", [".saf/runtime/", ".saf/config.local.yaml"]);
    expect(once).toBe("dist/\n.saf/runtime/\n.saf/config.local.yaml\n");
    expect(mergeGitignore(once, [".saf/runtime/", ".saf/config.local.yaml"])).toBe(once);
  });
});
