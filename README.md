# SAF

Opinionated local CLI for a safe coding-agent workflow. The first implementation slice provides the CLI shell and contracts used by later workflow commands.

## Development

Requirements: Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
node dist/cli.js --version
```

The executable is exposed as `saf` when the package is linked or installed. SAF uses exit code `0` for success, `2` for invalid CLI usage, `3` for invalid configuration, `4` for missing prerequisites, `5` for failed external commands and `130` for cancellation.

The repository-local configuration path is `.saf/config.yaml`; its schema follows [docs/saf-mvp.md](docs/saf-mvp.md).

## Repository initialization

Initialize SAF against one existing repository-scoped GitHub Project:

```bash
saf init --project zbrg/5 --validation "pnpm check" --yes
```

Interactive runs may confirm discovered validation commands. Non-interactive runs must pass each command explicitly with a repeated `--validation` option. Use `--dry-run` to perform preflight checks without writing files. Changing an existing Project binding additionally requires `--rebind` and confirmation (or `--yes`).

Initialization requires authenticated `gh` access and installed `claude`, `ralphex`, `codex` and `revdiff` executables. SAF obtains the active token from `gh` only in memory and uses Octokit behind its own GitHub adapter; credentials are never written to config or runtime files. Initialization creates tracked `.saf/config.yaml`, ignored `.saf/runtime/`, and adds `.saf/config.local.yaml` to `.gitignore`.

## Workflow status

Read workflow facts and derive the effective state for one Issue:

```bash
saf status 42
saf status 42 --json
```

The command is read-only and does not depend on `.saf/runtime/`. Project Status and evidence-derived state are displayed separately. Reducer precedence and marker contracts are documented in [docs/status-derivation.md](docs/status-derivation.md).

## Issue shaping

Start an interactive Claude Code + GLM brainstorm/planning session:

```bash
saf shape 42
```

Or import an existing plan for recovery:

```bash
saf shape 42 --plan docs/plans/active/issue-42.md
saf shape 42 --plan docs/plans/active/issue-42.md --dry-run
```

SAF lints the plan, opens it in revdiff, requires explicit approval, publishes the shared human-readable `approved-plan` marker, and only then moves the Project item to `Ready`. Non-interactive approval requires the explicit `--yes` flag.

## Building an approved plan

Execute the exact approved plan through Ralphex + Codex and create or recover one Draft Pull Request:

```bash
saf build 42 --dry-run
saf build 42
```

The command requires a clean workspace and an Issue in `Ready`, records a human-readable run marker, runs configured validation commands without a shell, and pushes only the generated feature branch without force. A successful run moves the Project item to `Review`; execution, validation, push or PR failures preserve recovery evidence and move it to `Blocked`.
