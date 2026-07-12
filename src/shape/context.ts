import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { SafConfigV1 } from "../config/schema.js";
import type { IssueDetails } from "../github/types.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";
import { stringify } from "yaml";

type ContextExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function writePlanningContext(root: string, config: SafConfigV1, issue: IssueDetails, execute: ContextExecutor = runCommand): Promise<CommandResult<string>> {
  const projectPath = join(root, config.documentation.projectFile);
  const agentsPath = join(root, config.documentation.agentsFile);
  let project: string;
  let agents: string;
  try {
    [project, agents] = await Promise.all([readFile(projectPath, "utf8"), readFile(agentsPath, "utf8")]);
  } catch {
    return failure([{ code: "CONFIG_INVALID", severity: "error", message: "Configured PROJECT.md or AGENTS.md could not be read.", remediation: "Restore configured documentation files before shaping." }]);
  }
  const tree = await execute({ command: "git", args: ["ls-files"], cwd: root });
  if (!tree.ok) return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unable to collect repository tree for planning.", remediation: "Check the Git repository and retry." }]);
  const contextPath = join(root, ".saf/runtime/shape", `issue-${issue.number}-context.md`);
  const content = [
    `# SAF planning context for Issue #${issue.number}`,
    "",
    "## Issue",
    `Title: ${issue.title}`,
    "",
    issue.body || "(empty body)",
    "",
    "## Required product questions",
    "- What problem does this solve?",
    "- Why is it needed now?",
    "- What is the minimum sufficient outcome?",
    "- What can be removed?",
    "- Is it compatible with PROJECT.md?",
    "- What locally-correct change could make the project worse?",
    "",
    `## ${config.documentation.projectFile}`,
    project,
    "",
    `## ${config.documentation.agentsFile}`,
    agents,
    "",
    "## .saf/config.yaml",
    "```yaml",
    stringify(config).trimEnd(),
    "```",
    "",
    "## Repository tree",
    "```text",
    tree.data.stdout.split("\n").slice(0, 1000).join("\n"),
    "```",
    ""
  ].join("\n");
  await mkdir(dirname(contextPath), { recursive: true });
  await writeFile(contextPath, content, "utf8");
  return success(contextPath);
}
