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
import { revisePlan, runPlanner } from "./shape/planner.js";
import { reviewPlan } from "./shape/review.js";
import { writePlanningContext } from "./shape/context.js";
import { buildIssue } from "./build/build.js";
import { runRalphex, runValidation } from "./build/execution.js";
import { reviewIssue } from "./review/review.js";
import { reviewDiff } from "./review/revdiff.js";
import { writeReviewPacket } from "./review/packet.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm?: (message: string) => Promise<boolean>;
  input?: (message: string) => Promise<string>;
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
    .option("--yes", "explicitly approve the reviewed plan", false)
    .action(async (issueValue: string, options: { plan?: string; yes: boolean }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const confirm = io.confirm ?? (async () => false);
      const result = await shapeIssue({ issue: Number(issueValue), ...(options.plan ? { planPath: options.plan } : {}), dryRun: globals.dryRun === true, yes: options.yes, interactive: io.interactive === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, prompt: { confirm }, planner: runPlanner, reviser: revisePlan, reviewer: reviewPlan, context: writePlanningContext });
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("build")
    .description("execute an approved plan and create a Draft Pull Request")
    .argument("<issue>", "positive GitHub Issue number")
    .action(async (issueValue: string, _options: unknown, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const result = await buildIssue({ issue: Number(issueValue), dryRun: globals.dryRun === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, ralphex: runRalphex, validation: runValidation });
      const rendered = renderResult(result, globals.json === true ? "json" : "human");
      if (rendered.length > 0) (result.ok ? io.stdout : io.stderr)(`${rendered}\n`);
      commandExitCode = exitCodeFor(result.diagnostics);
    });

  program.command("review")
    .description("review a Draft Pull Request and accept its exact head SHA")
    .argument("<issue>", "positive GitHub Issue number")
    .option("--sha <sha>", "explicit current head SHA for non-interactive acceptance")
    .action(async (issueValue: string, options: { sha?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean; dryRun?: boolean }>();
      const result = await reviewIssue({ issue: Number(issueValue), dryRun: globals.dryRun === true, ...(options.sha ? { confirmationSha: options.sha } : {}), interactive: io.interactive === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, github: createAuthenticatedGitHubAdapter, prompt: { input: io.input ?? (async () => "") }, reviewer: reviewDiff, writePacket: writeReviewPacket });
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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
