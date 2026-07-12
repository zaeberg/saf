import type { Diagnostic } from "./diagnostic.js";

export type CommandResult<T> =
  | { ok: true; data: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export function success<T>(data: T, diagnostics: Diagnostic[] = []): CommandResult<T> {
  return { ok: true, data, diagnostics };
}

export function failure<T = never>(diagnostics: Diagnostic[]): CommandResult<T> {
  return { ok: false, diagnostics };
}
