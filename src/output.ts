import type { Diagnostic } from "./contracts/diagnostic.js";
import type { CommandResult } from "./contracts/result.js";

export type OutputMode = "human" | "json";

export function renderResult<T>(result: CommandResult<T>, mode: OutputMode): string {
  if (mode === "json") return JSON.stringify(result, null, 2);

  const lines = result.diagnostics.map(renderDiagnostic);
  if (result.ok && result.data !== undefined) {
    const data = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
    lines.push(data);
  }
  return lines.join("\n");
}

function renderDiagnostic(diagnostic: Diagnostic): string {
  const path = diagnostic.path === undefined ? "" : ` (${diagnostic.path})`;
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${path}: ${diagnostic.message}\n  Remedy: ${diagnostic.remediation}`;
}
