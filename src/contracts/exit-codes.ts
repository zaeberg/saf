import type { Diagnostic, DiagnosticCode } from "./diagnostic.js";

export const ExitCode = {
  Success: 0,
  InternalError: 1,
  InvalidUsage: 2,
  InvalidConfig: 3,
  PrerequisiteMissing: 4,
  ExternalCommandFailed: 5,
  Cancelled: 130
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

const exitCodeByDiagnostic: Record<DiagnosticCode, ExitCode> = {
  CONFIG_NOT_FOUND: ExitCode.InvalidConfig,
  CONFIG_INVALID: ExitCode.InvalidConfig,
  GIT_REPOSITORY_NOT_FOUND: ExitCode.PrerequisiteMissing,
  GITHUB_AUTH_MISSING: ExitCode.PrerequisiteMissing,
  CODEX_AUTH_MISSING: ExitCode.PrerequisiteMissing,
  GITHUB_NOT_FOUND: ExitCode.PrerequisiteMissing,
  GITHUB_RATE_LIMITED: ExitCode.PrerequisiteMissing,
  GITHUB_RESPONSE_INVALID: ExitCode.ExternalCommandFailed,
  PROJECT_ACCESS_DENIED: ExitCode.PrerequisiteMissing,
  PROJECT_REPOSITORY_DRIFT: ExitCode.InvalidConfig,
  PROJECT_STATUS_FIELD_MISSING: ExitCode.InvalidConfig,
  PROJECT_STATUS_OPTION_MISSING: ExitCode.InvalidConfig,
  TOOL_NOT_FOUND: ExitCode.PrerequisiteMissing,
  COMMAND_FAILED: ExitCode.ExternalCommandFailed,
  COMMAND_CANCELLED: ExitCode.Cancelled,
  REBIND_REQUIRED: ExitCode.InvalidConfig,
  CONFIRMATION_REQUIRED: ExitCode.InvalidUsage,
  VALIDATION_COMMANDS_REQUIRED: ExitCode.InvalidUsage,
  SHAPE_STATE_INVALID: ExitCode.InvalidUsage,
  PLAN_NOT_FOUND: ExitCode.InvalidUsage,
  PLAN_AMBIGUOUS: ExitCode.InvalidUsage,
  PLAN_INVALID: ExitCode.InvalidUsage,
  BUILD_STATE_INVALID: ExitCode.InvalidUsage,
  WORKSPACE_DIRTY: ExitCode.InvalidUsage,
  ACTIVE_RUN_EXISTS: ExitCode.InvalidUsage,
  VALIDATION_FAILED: ExitCode.ExternalCommandFailed,
  BRANCH_INVALID: ExitCode.InvalidUsage,
  REVIEW_STATE_INVALID: ExitCode.InvalidUsage,
  INVALID_ARGUMENT: ExitCode.InvalidUsage,
  INTERNAL_ERROR: ExitCode.InternalError
};

export function exitCodeFor(diagnostics: Diagnostic[]): ExitCode {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return ExitCode.Success;
  return Math.max(...errors.map((diagnostic) => exitCodeByDiagnostic[diagnostic.code])) as ExitCode;
}
