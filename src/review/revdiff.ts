import { readFile } from "node:fs/promises";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export interface ReviewAnnotation { location: string; message: string; severity: "blocking" | "non-blocking"; }
export interface RevdiffReview { annotations: ReviewAnnotation[]; }
export type RevdiffExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function reviewDiff(root: string, base: string, branch: string, packetPath: string, annotationsPath: string, execute: RevdiffExecutor = runCommand): Promise<CommandResult<RevdiffReview>> {
  const result = await execute({ command: "revdiff", args: [base, branch, `--output=${annotationsPath}`, "--exit-code-on-annotations", `--description-file=${packetPath}`], cwd: root, stdio: "inherit", acceptedExitCodes: [0, 10] });
  if (!result.ok) return result;
  if (result.data.exitCode === 0) return success({ annotations: [] });
  try {
    const annotations = parseAnnotations(await readFile(annotationsPath, "utf8"));
    return annotations.length > 0
      ? success({ annotations })
      : failure([{ code: "COMMAND_FAILED", severity: "error", message: "revdiff reported annotations in an unsupported output format.", remediation: "Inspect the annotations file and update SAF/revdiff before accepting." }]);
  }
  catch { return failure([{ code: "COMMAND_FAILED", severity: "error", message: "revdiff reported annotations but did not produce its output file.", remediation: "Inspect revdiff output and rerun saf review." }]); }
}

export function parseAnnotations(markdown: string): ReviewAnnotation[] {
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return headings.map((heading, index) => {
    const bodyStart = heading.index! + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? markdown.length;
    const raw = markdown.slice(bodyStart, bodyEnd).trim();
    const tagged = /^\[(blocking|non-blocking)\]\s*/i.exec(raw);
    return { location: heading[1]!.trim(), message: raw.replace(/^\[(?:blocking|non-blocking)\]\s*/i, "").trim(), severity: tagged?.[1]?.toLowerCase() === "non-blocking" ? "non-blocking" : "blocking" };
  });
}
