import { z } from "zod";
import { failure, success, type CommandResult } from "../contracts/result.js";
import type { ProjectReference } from "../init/project-reference.js";
import { runCommand, type CommandInvocation } from "../runner/command-runner.js";

export const requiredProjectStatuses = ["Backlog", "Shaping", "Ready", "Running", "Review", "Blocked", "Done"] as const;

const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.object({ nodes: z.array(z.object({ name: z.string().optional(), options: z.array(z.object({ id: z.string(), name: z.string() })).optional() }).passthrough()) }),
  items: z.object({
    nodes: z.array(z.object({ content: z.object({ repository: z.object({ nameWithOwner: z.string() }).optional() }).nullable().optional() }).passthrough()),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
  })
});
const responseSchema = z.object({ data: z.object({ owner: z.object({ projectV2: projectSchema.nullable() }).nullable() }) });

const query = `query($owner:String!,$number:Int!,$after:String){
  owner: repositoryOwner(login:$owner){
    ... on Organization {projectV2(number:$number){...ProjectData}}
    ... on User {projectV2(number:$number){...ProjectData}}
  }
}
fragment ProjectData on ProjectV2 {
  id title
  fields(first:100){nodes{... on ProjectV2SingleSelectField{name options{id name}}}}
  items(first:100,after:$after){nodes{content{... on Issue{repository{nameWithOwner}} ... on PullRequest{repository{nameWithOwner}}}} pageInfo{hasNextPage endCursor}}
}`;

export interface ProjectDetails { id: string; title: string; statusOptions: Array<{ id: string; name: string }>; }
export type GhExecutor = (invocation: CommandInvocation) => ReturnType<typeof runCommand>;

export async function loadProject(reference: ProjectReference, repository: string, cwd: string, execute: GhExecutor = runCommand): Promise<CommandResult<ProjectDetails>> {
  let after: string | null = null;
  let selected: z.infer<typeof projectSchema> | undefined;
  const repositories = new Set<string>();
  do {
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${reference.owner}`, "-F", `number=${reference.number}`];
    if (after !== null) args.push("-F", `after=${after}`);
    const command = await execute({ command: "gh", args, cwd });
    if (!command.ok) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `Cannot access GitHub Project ${reference.owner}/${reference.number}.`, remediation: "Verify the Project reference and gh project scope." }]);
    const parsed = parseResponse(command.data.stdout);
    if (!parsed.ok) return parsed;
    const project = parsed.data.data.owner?.projectV2 ?? undefined;
    if (!project) return failure([{ code: "PROJECT_ACCESS_DENIED", severity: "error", message: `GitHub Project ${reference.owner}/${reference.number} was not found.`, remediation: "Verify owner, number and gh project scope." }]);
    selected ??= project;
    for (const item of project.items.nodes) if (item.content?.repository) repositories.add(item.content.repository.nameWithOwner.toLowerCase());
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after !== null);

  const foreign = [...repositories].filter((slug) => slug !== repository.toLowerCase());
  if (foreign.length > 0) return failure([{ code: "PROJECT_REPOSITORY_DRIFT", severity: "error", message: `Project contains items from other repositories: ${foreign.join(", ")}.`, remediation: "Use a repository-scoped Project containing only this repository." }]);
  const status = selected!.fields.nodes.find((field) => field.name === "Status");
  if (!status?.options) return failure([{ code: "PROJECT_STATUS_FIELD_MISSING", severity: "error", message: "Project field Status is missing or is not a single-select field.", remediation: "Create a single-select Status field with all SAF MVP options." }]);
  const available = new Set(status.options.map((option) => option.name));
  const missing = requiredProjectStatuses.filter((name) => !available.has(name));
  if (missing.length > 0) return failure([{ code: "PROJECT_STATUS_OPTION_MISSING", severity: "error", message: `Status is missing options: ${missing.join(", ")}.`, remediation: "Add all required SAF MVP Status options." }]);
  return success({ id: selected!.id, title: selected!.title, statusOptions: status.options });
}

function parseResponse(value: string): CommandResult<z.infer<typeof responseSchema>> {
  try {
    const parsed = responseSchema.safeParse(JSON.parse(value));
    if (parsed.success) return success(parsed.data);
  } catch { /* mapped below */ }
  return failure([{ code: "COMMAND_FAILED", severity: "error", message: "Unexpected GitHub GraphQL response.", remediation: "Update gh and retry with --verbose." }]);
}
