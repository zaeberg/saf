# SAF

Opinionated local CLI for a safe coding-agent workflow. The first implementation slice provides the CLI shell and contracts used by later workflow commands.

## Development

Requirements: Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
node dist/cli.js --version
```

The executable is exposed as `saf` when the package is linked or installed. SAF uses exit code `0` for success, `2` for invalid CLI usage, `3` for invalid configuration, `4` for missing prerequisites, `5` for failed external commands and `130` for cancellation.

Configuration loading is read-only in this slice. The expected repository-local path is `.saf/config.yaml`; its schema follows [docs/saf-mvp.md](docs/saf-mvp.md).
