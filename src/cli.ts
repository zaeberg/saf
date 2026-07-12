#!/usr/bin/env node
import { runCli } from "./cli-program.js";
import { terminalPromptAdapter } from "./prompt/prompt-adapter.js";

const result = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  interactive: process.stdin.isTTY,
  confirm: process.stdin.isTTY ? terminalPromptAdapter.confirm : async () => false,
  input: process.stdin.isTTY ? terminalPromptAdapter.input : async () => ""
});

process.exitCode = result.exitCode;
