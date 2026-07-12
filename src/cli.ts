#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { runCli } from "./cli-program.js";

const result = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  interactive: process.stdin.isTTY,
  confirm: async (message) => {
    if (!process.stdin.isTTY) return false;
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await prompt.question(`${message} [y/N] `)).trim().toLowerCase() === "y"; }
    finally { prompt.close(); }
  }
});

process.exitCode = result.exitCode;
