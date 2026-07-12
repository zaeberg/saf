export const diagnosticCodes = [
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "GIT_REPOSITORY_NOT_FOUND",
  "GITHUB_AUTH_MISSING",
  "PROJECT_ACCESS_DENIED",
  "PROJECT_REPOSITORY_DRIFT",
  "TOOL_NOT_FOUND",
  "COMMAND_FAILED",
  "COMMAND_CANCELLED",
  "INVALID_ARGUMENT",
  "INTERNAL_ERROR"
] as const;

export type DiagnosticCode = (typeof diagnosticCodes)[number];
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  remediation: string;
  path?: string;
}
