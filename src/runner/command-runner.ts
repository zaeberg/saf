import { spawn } from "node:child_process";
import { once } from "node:events";
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
    const child = spawn(invocation.command, args, {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let rawStdout = "";
    let rawStderr = "";
    const stdoutStream = createSafeStream(secrets, invocation.onStdout);
    const stderrStream = createSafeStream(secrets, invocation.onStderr);
    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      rawStdout += chunk;
      stdoutStream.write(chunk);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      rawStderr += chunk;
      stderrStream.write(chunk);
    });
    const stdoutEnded = once(child.stdout, "end");
    const stderrEnded = once(child.stderr, "end");
    const abort = (): void => { child.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    const [closeEvent] = await Promise.all([once(child, "close"), stdoutEnded, stderrEnded]);
    const [exitCode] = closeEvent as [number | null, NodeJS.Signals | null];
    stdoutStream.end();
    stderrStream.end();
    signal?.removeEventListener("abort", abort);

    if (isAborted(signal)) return cancelled(safeCommand, safeArgs);
    const execution = {
      command: safeCommand,
      args: safeArgs,
      exitCode: exitCode ?? 1,
      stdout: redact(rawStdout, secrets),
      stderr: redact(rawStderr, secrets),
      dryRun: false
    };
    if (execution.exitCode !== 0) {
      return failure([{ code: "COMMAND_FAILED", severity: "error", message: `Command ${safeCommand} exited with code ${execution.exitCode}.`, remediation: "Inspect the command output and retry." }]);
    }
    return success(execution);
  } catch (error: unknown) {
    const message = redact(error instanceof Error ? error.message : "Unable to start command", secrets);
    const notFound = isNodeError(error) && error.code === "ENOENT";
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
