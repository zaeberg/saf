export const diagnosticCodes = [
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "GIT_REPOSITORY_NOT_FOUND",
  "GITHUB_AUTH_MISSING",
  "GITHUB_NOT_FOUND",
  "GITHUB_RATE_LIMITED",
  "GITHUB_RESPONSE_INVALID",
  "PROJECT_ACCESS_DENIED",
  "PROJECT_REPOSITORY_DRIFT",
  "PROJECT_STATUS_FIELD_MISSING",
  "PROJECT_STATUS_OPTION_MISSING",
  "TOOL_NOT_FOUND",
  "COMMAND_FAILED",
  "COMMAND_CANCELLED",
  "REBIND_REQUIRED",
  "CONFIRMATION_REQUIRED",
  "VALIDATION_COMMANDS_REQUIRED",
  "SHAPE_STATE_INVALID",
  "PLAN_NOT_FOUND",
  "PLAN_AMBIGUOUS",
  "PLAN_INVALID",
  "PLAN_REVIEW_REQUIRED",
  "PLAN_APPROVAL_REQUIRED",
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
