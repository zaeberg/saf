#!/usr/bin/env node
import { runCli } from "./cli-program.js";

const result = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
});

process.exitCode = result.exitCode;
