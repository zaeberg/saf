import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ZodError } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";
import { configSchemaV1, type SafConfigV1 } from "./schema.js";

export async function loadConfig(filePath = ".saf/config.yaml"): Promise<CommandResult<SafConfigV1>> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return failure([{ code: "CONFIG_NOT_FOUND", severity: "error", message: `Configuration file not found: ${filePath}`, remediation: "Run saf init in this repository." }]);
    }
    return failure([{ code: "CONFIG_INVALID", severity: "error", message: safeErrorMessage(error), remediation: `Check that ${filePath} is readable.` }]);
  }

  try {
    return success(configSchemaV1.parse(parse(source)));
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return failure(error.issues.map((issue) => ({
        code: "CONFIG_INVALID" as const,
        severity: "error" as const,
        message: issue.message,
        remediation: "Correct the field to match SAF config schema v1.",
        path: formatPath(issue.path)
      })));
    }
    return failure([{ code: "CONFIG_INVALID", severity: "error", message: safeErrorMessage(error), remediation: "Correct the YAML syntax." }]);
  }
}

function formatPath(path: PropertyKey[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown configuration error";
}
