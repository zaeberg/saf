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

Initialization requires authenticated `gh` access and installed `claude`, `ralphex`, `codex` and `revdiff` executables. It creates tracked `.saf/config.yaml`, ignored `.saf/runtime/`, and adds `.saf/config.local.yaml` to `.gitignore`.
