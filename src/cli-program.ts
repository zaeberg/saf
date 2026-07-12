import { Command, CommanderError, Option } from "commander";
import { ExitCode } from "./contracts/exit-codes.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliRunResult {
  exitCode: number;
}

export async function runCli(argv: string[], io: CliIo): Promise<CliRunResult> {
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

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode: ExitCode.Success };
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
