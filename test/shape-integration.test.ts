import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import type { SafConfigV1 } from "../src/config/schema.js";
import { failure, success } from "../src/contracts/result.js";
import type { GitHubAdapter, IssueDetails } from "../src/github/types.js";
import type { CommandExecution, CommandInvocation } from "../src/runner/command-runner.js";
import { parseMarkers } from "../src/status/markers.js";
import { shapeIssue } from "../src/shape/shape.js";

describe("saf shape integration", () => {
  it("publishes one approved plan and is idempotent", async () => {
    const fixture = await shapeFixture();
    const github = statefulAdapter();
    const dependencies = shapeDependencies(fixture.root, github.adapter);
    const options = { issue: 42, planPath: fixture.planPath, dryRun: false, yes: true, interactive: false, cwd: fixture.root };
    const first = await shapeIssue(options, dependencies);
    expect(first).toMatchObject({ ok: true, data: { state: "Ready", revision: 1, commentChanged: true } });
    expect(github.statuses).toEqual(["Shaping", "Ready"]);
    expect(github.comments).toHaveLength(1);
    const parsed = parseMarkers(github.issue.comments, 42);
    expect(parsed.approvedPlan).toMatchObject({ revision: 1, issue: 42 });
    expect(github.comments[0]).toContain("**SAF · Approved plan**");

    const second = await shapeIssue(options, dependencies);
    expect(second).toMatchObject({ ok: true, data: { revision: 1, commentChanged: false } });
    expect(github.comments).toHaveLength(1);
    expect(github.statuses).toEqual(["Shaping", "Ready"]);
  });

  it("does not publish or transition during dry-run", async () => {
    const fixture = await shapeFixture();
    const github = statefulAdapter();
    const reviewer = vi.fn(async () => success({ annotations: false }));
    const dependencies = { ...shapeDependencies(fixture.root, github.adapter), reviewer };
    const result = await shapeIssue({ issue: 42, planPath: fixture.planPath, dryRun: true, yes: false, interactive: false, cwd: fixture.root }, dependencies);
    expect(result).toMatchObject({ ok: true, data: { state: "DryRun", commentChanged: false } });
    expect(github.statuses).toEqual([]);
    expect(github.comments).toEqual([]);
    expect(reviewer).not.toHaveBeenCalled();
  });

  it("does not transition to Ready when revdiff fails", async () => {
    const fixture = await shapeFixture();
    const github = statefulAdapter();
    const reviewer = vi.fn(async () => failure([{ code: "COMMAND_FAILED", severity: "error", message: "revdiff failed", remediation: "retry" }]));
    const result = await shapeIssue({ issue: 42, planPath: fixture.planPath, dryRun: false, yes: true, interactive: false, cwd: fixture.root }, { ...shapeDependencies(fixture.root, github.adapter), reviewer });
    expect(result).toMatchObject({ ok: false });
    expect(github.statuses).toEqual(["Shaping"]);
    expect(github.comments).toEqual([]);
  });

  it("runs planner mode and repeats review after annotations", async () => {
    const fixture = await shapeFixture();
    const github = statefulAdapter();
    const planner = vi.fn(async () => success(fixture.planPath));
    const reviewer = vi.fn()
      .mockResolvedValueOnce(success({ annotations: true }))
      .mockResolvedValueOnce(success({ annotations: false }));
    const reviser = vi.fn(async () => success(undefined));
    const result = await shapeIssue(
      { issue: 42, dryRun: false, yes: true, interactive: true, cwd: fixture.root },
      { ...shapeDependencies(fixture.root, github.adapter), planner, reviewer, reviser }
    );
    expect(result).toMatchObject({ ok: true, data: { state: "Ready" } });
    expect(planner).toHaveBeenCalledOnce();
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(reviser).toHaveBeenCalledOnce();
  });

  it("leaves the Issue in Shaping when planner fails", async () => {
    const fixture = await shapeFixture();
    const github = statefulAdapter();
    const planner = vi.fn(async () => failure<string>([{ code: "COMMAND_FAILED", severity: "error", message: "planner failed", remediation: "retry" }]));
    const result = await shapeIssue(
      { issue: 42, dryRun: false, yes: true, interactive: true, cwd: fixture.root },
      { ...shapeDependencies(fixture.root, github.adapter), planner }
    );
    expect(result).toMatchObject({ ok: false });
    expect(github.statuses).toEqual(["Shaping"]);
    expect(github.comments).toEqual([]);
  });
});

async function shapeFixture(): Promise<{ root: string; planPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "saf-shape-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".saf"));
  await writeFile(join(root, ".saf/config.yaml"), stringify(config));
  await writeFile(join(root, "PROJECT.md"), "# Project\n");
  await writeFile(join(root, "AGENTS.md"), "# Agents\n");
  const planPath = join(root, "plan.md");
  await writeFile(planPath, validPlan);
  return { root, planPath };
}

function statefulAdapter(): { adapter: GitHubAdapter; issue: IssueDetails; statuses: string[]; comments: string[] } {
  const statuses: string[] = [];
  const comments: string[] = [];
  const issue: IssueDetails = { number: 42, title: "Shape me", state: "open", body: "Outcome", comments: [] };
  let projectStatus = "Backlog";
  const adapter: GitHubAdapter = {
    getRepository: async () => success({ repository: "zbrg/saf", defaultBranch: "master" }),
    getProject: async () => success({ id: "project", title: "SAF", statusFieldId: "status", statusOptions: [] }),
    getIssue: async () => success(issue),
    getProjectItem: async () => success({ id: "item", status: projectStatus }),
    getPullRequest: async () => failure([]),
    getChecks: async () => failure([]),
    getCommitStatus: async () => failure([]),
    setProjectItemStatus: async (_reference, _repository, _item, status) => { projectStatus = status; statuses.push(status); return success(undefined); },
    createIssueComment: async (_repository, _issue, body) => { comments.push(body); issue.comments.push({ id: 1, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }); return success({ id: 1 }); },
    updateIssueComment: async (_repository, id, body) => { comments[id - 1] = body; issue.comments[id - 1] = { id, body, createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z" }; return success({ id }); },
    findPullRequestByBranch: async () => success(null),
    createOrUpdateDraftPullRequest: async () => failure([]),
    addPullRequestToProject: async () => success(undefined)
  };
  return { adapter, issue, statuses, comments };
}

function shapeDependencies(root: string, adapter: GitHubAdapter) {
  return {
    execute: executor(root),
    github: async () => success(adapter),
    prompt: { confirm: async () => true },
    planner: async () => failure<string>([]),
    reviser: async () => success(undefined),
    reviewer: async () => success({ annotations: false }),
    context: async () => success(join(root, "context.md"))
  };
}

function executor(root: string) {
  return async (invocation: CommandInvocation) => {
    const args = invocation.args ?? [];
    let stdout = "";
    if (args[0] === "rev-parse") stdout = root;
    else if (args[0] === "remote") stdout = "git@github.com:zbrg/saf.git";
    else if (args.includes("--show-current")) stdout = "master";
    else if (args.includes("--format=%(refname:short)")) stdout = "master";
    else if (args[0] === "ls-files") stdout = "PROJECT.md\nAGENTS.md\n";
    return success<CommandExecution>({ command: invocation.command, args, exitCode: 0, stdout, stderr: "", dryRun: false });
  };
}

const config: SafConfigV1 = { version: 1, github: { repository: "zbrg/saf", project: { owner: "zbrg", number: 5 } }, repository: { defaultBranch: "master" }, documentation: { projectFile: "PROJECT.md", agentsFile: "AGENTS.md", plansDirectory: "docs/plans/active" }, planning: { adapter: "claude-glm" }, execution: { adapter: "ralphex-codex", maxConcurrentRuns: 1 }, review: { adapter: "revdiff" }, validation: { commands: ["pnpm check"] } };
const validPlan = `# Plan

## Goal

Deliver one focused and verifiable workflow improvement without expanding the product scope.

## Tasks

- Implement the required behavior behind existing adapters.
- Add deterministic tests for success, failure and recovery.

## Acceptance criteria

- The command produces the documented result and remains idempotent.
- Failure does not publish a successful transition.

## Validation

\`\`\`bash
pnpm check
\`\`\`
`;
