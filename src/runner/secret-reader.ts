import { execa, type Options as ExecaOptions } from "execa";
import type { CommandInvocation } from "./command-runner.js";

export async function readCommandSecret(invocation: Omit<CommandInvocation, "dryRun" | "secrets" | "onStdout" | "onStderr">): Promise<string> {
  const options = {
    extendEnv: invocation.env === undefined,
    shell: false,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    stripFinalNewline: true,
    ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
    ...(invocation.env === undefined ? {} : { env: invocation.env }),
    ...(invocation.signal === undefined ? {} : { cancelSignal: invocation.signal })
  } as const satisfies ExecaOptions;
  const result = await execa(invocation.command, invocation.args ?? [], options);
  return typeof result.stdout === "string" ? result.stdout : "";
}
