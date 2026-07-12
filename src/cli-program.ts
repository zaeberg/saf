import { Command, CommanderError, Option } from "commander";
import { ExitCode, exitCodeFor } from "./contracts/exit-codes.js";
import { initializeRepository } from "./init/init.js";
import { writeInitialization } from "./init/filesystem.js";
import { createAuthenticatedGitHubAdapter } from "./github/auth.js";
import { renderResult } from "./output.js";
import { runCommand } from "./runner/command-runner.js";
import { renderHumanStatus } from "./status/report.js";
import { getStatus } from "./status/status.js";
import { shapeIssue } from "./shape/shape.js";
import { runPlanner } from "./shape/planner.js";
import { buildIssue } from "./build/build.js";
import { runRalphex, runRalphexReview, runValidation } from "./build/execution.js";
import { reviewIssue } from "./review/review.js";
import type { PromptAdapter } from "./prompt/prompt-adapter.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm?: (message: string) => Promise<boolean>;
  input?: PromptAdapter["input"];
  select?: PromptAdapter["select"];
  cwd?: string;
  interactive?: boolean;
}

export interface CliRunResult {
  exitCode: number;
}

export async function runCli(argv: string[], io: CliIo): Promise<CliRunResult> {
  let commandExitCode = ExitCode.Success as number;
  const program = new Command()
    .name("saf")
    .description("Opinionated local workflow for coding agents")
    .version("0.1.0")
    .addOption(new Option("--json", "emit machine-readable JSON output"))
    .addOption(new Option("--dry-run", "describe actions without executing them"))
    .addOption(new Option("--verbose", "emit detailed execution information"))
    .allowUnknownOption(false)
    .allowExcessArguments(false)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr
    });

  program.command("init")
    .description("bind this repository to an existing GitHub Project")
    .requiredOption("--project <owner/number>", "explicit GitHub Project reference")
    .option("--validation <command>", "validation command; repeat for multiple commands", collect, [])
    .option("--rebind", "allow changing an existing Project binding", false)
    .option("--yes", "confirm reviewed validation commands or rebind", false)
    .action(async (options: { project: string; validation: string[]; rebind: boolean; yes: boolean }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const result = await initializeRepository({ project: options.project, validationCommands: options.validation, rebind: options.rebind, dryRun: globals.dryRun === true, yes: options.yes, interactive: io.interactive === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, confirm: io.confirm ?? (async () => false), write: writeInitialization });
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("status")
    .description("derive workflow state for one GitHub Issue")
    .argument("<issue>", "positive GitHub Issue number")
    .action(async (issueValue: string, _options: unknown, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      const result = await getStatus(Number(issueValue), io.cwd ?? process.cwd(), { execute: runCommand, github: createAuthenticatedGitHubAdapter });
      const rendered = globals.json === true ? renderResult(result, "json") : renderHumanStatus(result);
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("shape")
    .description("shape one GitHub Issue into an approved plan")
    .argument("<issue>", "positive GitHub Issue number")
    .option("--plan <path>", "import an existing plan instead of launching the planner")
    .action(async (issueValue: string, options: { plan?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const result = await shapeIssue({ issue: Number(issueValue), ...(options.plan ? { planPath: options.plan } : {}), dryRun: globals.dryRun === true, interactive: io.interactive === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, planner: runPlanner });
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("build")
    .description("execute an approved plan and create a Draft Pull Request")
    .argument("<issue>", "positive GitHub Issue number")
    .option("--tasks-only", "run only Ralphex task phase and skip reviews")
    .option("--task-model <model>", "Ralphex task model as model[:effort]")
    .action(async (issueValue: string, options: { tasksOnly?: boolean; taskModel?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const result = await buildIssue({ issue: Number(issueValue), dryRun: globals.dryRun === true, interactive: io.interactive === true, ...(options.tasksOnly === true ? { tasksOnly: true } : {}), ...(options.taskModel ? { taskModel: options.taskModel } : {}), cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, ralphex: runRalphex, validation: runValidation, prompt: promptFromIo(io) });
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("review")
    .description("run the Ralphex automated review pipeline")
    .argument("<issue>", "positive GitHub Issue number")
    .option("--review-model <model>", "Ralphex review model as model[:effort]")
    .option("--external-review-tool <tool>", "external review tool: codex or claude")
    .action(async (issueValue: string, options: { reviewModel?: string; externalReviewTool?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const tool = options.externalReviewTool;
      const validTool = tool === undefined || tool === "codex" || tool === "claude";
      const result = validTool
        ? await reviewIssue({ issue: Number(issueValue), dryRun: globals.dryRun === true, interactive: io.interactive === true, ...(options.reviewModel ? { reviewModel: options.reviewModel } : {}), ...(tool ? { externalReviewTool: tool } : {}), cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, ralphex: runRalphexReview, validation: runValidation, prompt: promptFromIo(io) })
        : failureReviewTool(tool);
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode: commandExitCode };
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return { exitCode: ExitCode.Success };
      }
      return { exitCode: ExitCode.InvalidUsage };
    }
    throw error;
  }
}

function promptFromIo(io: CliIo): Pick<PromptAdapter, "input" | "select"> {
  return {
    input: io.input ?? (async (_message, value = "") => value),
    select: io.select ?? (async (_message, _choices, value) => value)
  };
}

function failureReviewTool(tool: string) {
  return { ok: false as const, diagnostics: [{ code: "INVALID_ARGUMENT" as const, severity: "error" as const, message: `Invalid external review tool: ${tool}`, remediation: "Use codex or claude." }] };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
