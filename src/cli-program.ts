import { Command, CommanderError, Option } from "commander";
import { ExitCode, exitCodeFor } from "./contracts/exit-codes.js";
import { initializeRepository } from "./init/init.js";
import { writeInitialization } from "./init/filesystem.js";
import { renderResult } from "./output.js";
import { runCommand } from "./runner/command-runner.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm?: (message: string) => Promise<boolean>;
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
      const result = await initializeRepository({ project: options.project, validationCommands: options.validation, rebind: options.rebind, dryRun: globals.dryRun === true, yes: options.yes, interactive: io.interactive === true, cwd: io.cwd ?? process.cwd() }, { execute: runCommand, confirm: io.confirm ?? (async () => false), write: writeInitialization });
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
