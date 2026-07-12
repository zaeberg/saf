import { execa, type Options as ExecaOptions } from "execa";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { redact, redactArgv } from "./redact.js";

export interface CommandInvocation {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  secrets?: string[];
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  stdio?: "capture" | "inherit";
  acceptedExitCodes?: number[];
}

export interface CommandExecution {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  dryRun: boolean;
}

export async function runCommand(invocation: CommandInvocation): Promise<CommandResult<CommandExecution>> {
  const args = invocation.args ?? [];
  const secrets = invocation.secrets ?? [];
  const safeCommand = redact(invocation.command, secrets);
  const safeArgs = redactArgv(args, secrets);

  if (invocation.dryRun === true) {
    return success({ command: safeCommand, args: safeArgs, exitCode: 0, stdout: "", stderr: "", dryRun: true });
  }
  const signal = invocation.signal;
  if (isAborted(signal)) return cancelled(safeCommand, safeArgs);

  try {
    const inherited = invocation.stdio === "inherit";
    const options = {
      extendEnv: invocation.env === undefined,
      shell: false,
      stdin: inherited ? "inherit" : "ignore",
      stdout: inherited ? "inherit" : "pipe",
      stderr: inherited ? "inherit" : "pipe",
      reject: false,
      stripFinalNewline: false,
      ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
      ...(invocation.env === undefined ? {} : { env: invocation.env }),
      ...(signal === undefined ? {} : { cancelSignal: signal })
    } as const satisfies ExecaOptions;
    const child = execa(invocation.command, args, options);
    const stdoutStream = createSafeStream(secrets, invocation.onStdout);
    const stderrStream = createSafeStream(secrets, invocation.onStderr);
    child.stdout?.on("data", (buffer: Buffer) => {
      stdoutStream.write(buffer.toString());
    });
    child.stderr?.on("data", (buffer: Buffer) => {
      stderrStream.write(buffer.toString());
    });
    const result = await child;
    stdoutStream.end();
    stderrStream.end();

    if (result.isCanceled || isAborted(signal)) return cancelled(safeCommand, safeArgs);
    const execution = {
      command: safeCommand,
      args: safeArgs,
      exitCode: result.exitCode ?? 1,
      stdout: redact(typeof result.stdout === "string" ? result.stdout : "", secrets),
      stderr: redact(typeof result.stderr === "string" ? result.stderr : "", secrets),
      dryRun: false
    };
    if (!(invocation.acceptedExitCodes ?? [0]).includes(execution.exitCode)) {
      return failure([{ code: "COMMAND_FAILED", severity: "error", message: `Command ${safeCommand} exited with code ${execution.exitCode}.`, remediation: "Inspect the command output and retry." }]);
    }
    return success(execution);
  } catch (error: unknown) {
    const message = redact(error instanceof Error ? error.message : "Unable to start command", secrets);
    const notFound = isErrorWithCode(error) && error.code === "ENOENT";
    return failure([{
      code: notFound ? "TOOL_NOT_FOUND" : "COMMAND_FAILED",
      severity: "error",
      message,
      remediation: notFound ? `Install ${safeCommand} and ensure it is on PATH.` : "Inspect the command and retry."
    }]);
  }
}

function cancelled(command: string, args: string[]): CommandResult<CommandExecution> {
  return failure([{ code: "COMMAND_CANCELLED", severity: "error", message: `Command cancelled: ${[command, ...args].join(" ")}`, remediation: "Retry the command when ready." }]);
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function createSafeStream(secrets: readonly string[], emit: ((chunk: string) => void) | undefined): { write: (chunk: string) => void; end: () => void } {
  let pending = "";
  return {
    write(chunk): void {
      pending += chunk;
      const safeEnd = findSafeEnd(pending, secrets);
      if (safeEnd > 0) {
        emit?.(redact(pending.slice(0, safeEnd), secrets));
        pending = pending.slice(safeEnd);
      }
    },
    end(): void {
      if (pending.length > 0) emit?.(redact(pending, secrets));
      pending = "";
    }
  };
}

function findSafeEnd(value: string, secrets: readonly string[]): number {
  let safeEnd = value.length;
  for (const secret of secrets.filter((candidate) => candidate.length > 1)) {
    const firstPossibleStart = Math.max(0, value.length - secret.length + 1);
    for (let start = firstPossibleStart; start < value.length; start += 1) {
      const suffix = value.slice(start);
      if (suffix.length < secret.length && secret.startsWith(suffix)) safeEnd = Math.min(safeEnd, start);
    }
  }
  return safeEnd;
}
