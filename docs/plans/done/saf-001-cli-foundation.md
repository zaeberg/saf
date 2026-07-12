# SAF-001 — CLI foundation and contracts

## Context

Репозиторий пока содержит только документацию. Все последующие команды зависят от единого CLI entrypoint, формата конфигурации, diagnostics и безопасного запуска внешних процессов.

## Goal

Создать минимальный TypeScript CLI `saf`, который запускается, валидирует аргументы и предоставляет стабильные базовые контракты для следующих срезов.

## Non-goals

- Git/GitHub API integration.
- Создание `.saf/config.yaml`.
- Реализация `init`, `status`, `shape`, `build` или `review`.
- Plugin framework и глобальный registry проектов.

## Technical approach

- Node.js CLI на TypeScript в ESM-режиме.
- `pnpm` как package manager.
- `commander` для command routing, `zod` для runtime schemas, `vitest` для тестов.
- Тонкий entrypoint; бизнес-логика не зависит от `process.exit` и console напрямую.
- Внешние процессы запускаются только через один command runner.

## Contracts

Зафиксировать:

- `.saf/config.yaml` schema v1 как TypeScript/Zod contract без writer;
- `CommandResult<T>`;
- `Diagnostic` с `code`, `severity`, `message`, `remediation`;
- стабильные exit codes;
- human и JSON output modes;
- redaction значений, помеченных как secrets.

Минимальные diagnostic codes:

```text
CONFIG_NOT_FOUND
CONFIG_INVALID
GIT_REPOSITORY_NOT_FOUND
GITHUB_AUTH_MISSING
PROJECT_ACCESS_DENIED
PROJECT_REPOSITORY_DRIFT
TOOL_NOT_FOUND
COMMAND_FAILED
```

## Tasks

### Task 1 — Bootstrap project

- Создать `package.json`, `pnpm-lock.yaml`, `tsconfig.json` и базовую source/test структуру.
- Добавить scripts: `build`, `typecheck`, `lint`, `test`, `check`.
- Настроить executable entrypoint `saf`.

### Task 2 — CLI shell

- Реализовать `saf --help` и `saf --version`.
- Добавить общие flags `--json`, `--dry-run`, `--verbose`.
- Запретить молчаливое игнорирование неизвестных arguments/options.

### Task 3 — Result and diagnostic contracts

- Реализовать typed result и diagnostic types.
- Реализовать единый mapping diagnostics в human/JSON output и exit codes.
- Добавить tests стабильности JSON shape.

### Task 4 — Config reader contract

- Описать schema v1 из MVP.
- Реализовать чтение и валидацию существующего `.saf/config.yaml` без его создания.
- Ошибки schema должны указывать field path.

### Task 5 — Command runner

- Реализовать argv-based subprocess invocation без shell interpolation.
- Поддержать streaming, captured result, cancellation и exit mapping.
- Реализовать dry-run и secret redaction.

## Acceptance criteria

1. `saf --help` и `saf --version` завершаются успешно.
2. Human и JSON output используют один typed result.
3. Невалидный config возвращает стабильный diagnostic и ненулевой exit code.
4. Command runner не использует shell по умолчанию и корректно передаёт argv.
5. Dry-run не запускает процесс.
6. Secrets не попадают в logs и diagnostics.
7. `pnpm check` проходит.

## Validation

```bash
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
node dist/cli.js --version
```

## Evidence required

- Вывод help/version.
- Пример JSON diagnostic для невалидного config.
- Unit tests config schema, output mapping и command runner.

## Documentation impact

- Добавить README с установкой development build и командами проверки.
- Если schema отличается от MVP, сначала обновить `docs/saf-mvp.md`.

