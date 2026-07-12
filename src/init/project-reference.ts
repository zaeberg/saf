import { z } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";

const projectReferenceSchema = z.string().regex(/^[^/\s]+\/[1-9]\d*$/, "expected <owner>/<positive-number>");

export interface ProjectReference { owner: string; number: number; }

export function parseProjectReference(value: string): CommandResult<ProjectReference> {
  const parsed = projectReferenceSchema.safeParse(value);
  if (!parsed.success) return failure([{ code: "INVALID_ARGUMENT", severity: "error", message: `Invalid project reference: ${value}`, remediation: "Use --project <owner>/<positive-number>." }]);
  const [owner, number] = parsed.data.split("/");
  return success({ owner: owner!, number: Number(number) });
}
