import { z } from "zod";

const projectSchema = z.strictObject({
  owner: z.string().min(1),
  number: z.number().int().positive()
});

export const configSchemaV1 = z.strictObject({
  version: z.literal(1),
  github: z.strictObject({
    repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/repository"),
    project: projectSchema
  }),
  repository: z.strictObject({
    defaultBranch: z.string().min(1)
  }),
  documentation: z.strictObject({
    plansDirectory: z.string().min(1)
  }),
  planning: z.strictObject({
    adapter: z.literal("claude-glm")
  }),
  execution: z.strictObject({
    adapter: z.literal("ralphex-codex"),
    maxConcurrentRuns: z.literal(1),
    tasksOnly: z.boolean().default(false),
    taskModel: z.string().min(1).optional()
  }),
  review: z.strictObject({
    adapter: z.union([z.literal("ralphex-codex"), z.literal("revdiff")]).transform(() => "ralphex-codex" as const),
    model: z.string().min(1).optional(),
    externalReviewTool: z.enum(["codex", "custom", "none"]).default("none")
  }),
  validation: z.strictObject({
    commands: z.array(z.string().min(1)).min(1)
  })
});

export type SafConfigV1 = z.infer<typeof configSchemaV1>;
