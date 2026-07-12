# SAF-002A — Unified GitHub transport

## Dependencies

- SAF-002 завершён и принят.

## Context

Оставшаяся часть MVP требует чтения и изменения GitHub Issue, comments, ProjectV2 items, Pull Request, checks и commit statuses. Продолжение через отдельные `gh api` argv-вызовы приведёт к дублированию pagination, error mapping, typed parsing и idempotency logic во всех последующих командах.

## Goal

Ввести единый `GitHubAdapter` на базе Octokit и перенести на него существующие repository/Project операции до реализации `saf status`, сохранив `gh` как источник authentication и не сохраняя credentials в SAF.

## Non-goals

- Реализация `status`, `shape`, `build` или `review`.
- Новые GitHub mutations за пределами уже реализованного `init`.
- Создание GitHub repository или Project.
- Cross-repository discovery и перечисление Projects.
- GitHub App, OAuth flow или собственное credential storage.
- GraphQL code generation.

## Architecture decision

```text
gh auth status
→ gh auth token
→ token только в памяти процесса
→ Octokit transport
→ repository-local GitHubAdapter
→ SAF commands
```

- `gh` остаётся обязательным CLI и credential provider.
- Token не записывается в config, runtime files, diagnostics, logs или test snapshots.
- Octokit используется для REST и GraphQL, pagination и нормализованных transport errors.
- Команды SAF зависят только от собственного `GitHubAdapter`, а не от Octokit types.
- Zod остаётся runtime boundary для данных, влияющих на workflow transitions.
- ProjectV2 работает через GraphQL; repository, Issue, comments, Pull Request, checks и commit statuses в следующих срезах используют REST, если подходящий endpoint существует.

## Tasks

### Task 1 — Authentication boundary

- Добавить `GitHubCredentialProvider` поверх `gh auth status` и `gh auth token`.
- Получать token только после успешного auth preflight.
- Помечать token как secret до любого debug/log output.
- Не включать token в `CommandResult`, diagnostics или публичные adapter results.
- Добавить tests, доказывающие отсутствие token в human/JSON output и thrown errors.

### Task 2 — Octokit transport

- Добавить обёртку создания Octokit client из in-memory token.
- Определить минимальный transport interface для REST request, GraphQL request и pagination.
- Нормализовать Octokit errors в стабильные SAF diagnostics.
- Различать authentication, access denied, not found, rate limit и unexpected response.
- Не экспортировать Octokit client из package public API.

### Task 3 — GitHub domain adapter

- Определить repository-local `GitHubAdapter` с операциями, уже необходимыми SAF-002:
  - получить repository и default branch;
  - проверить доступность Issues;
  - получить явно заданный ProjectV2;
  - получить все Issue/PR items Project с pagination;
  - получить поле `Status` и его options.
- Возвращать собственные domain DTO, не Octokit response objects.
- Сохранить запрет на discovery других repositories и Projects.

### Task 4 — Migrate SAF-002

- Перевести `githubPreflight` и Project lookup с `gh repo view` / `gh api graphql` на `GitHubAdapter`.
- Оставить tool execution и credential acquisition через общий command runner.
- Сохранить текущие diagnostic codes и observable CLI behaviour.
- Удалить старый GraphQL argv transport после прохождения contract tests.

### Task 5 — Test harness for remaining MVP

- Добавить fake `GitHubAdapter` для `status`, `shape`, `build` и `review` tests.
- Добавить transport-level fixtures для REST, GraphQL pagination и representative errors.
- Не выполнять live GitHub requests в обычном `pnpm test`.
- Добавить отдельный opt-in live smoke test против безопасного repository/Project.

## Acceptance criteria

1. SAF получает GitHub token через `gh`, использует его только в памяти и нигде не выводит.
2. Существующий `saf init` сохраняет CLI behaviour и diagnostics.
3. Repository и ProjectV2 читаются через единый `GitHubAdapter`.
4. Project pagination не ограничивается первыми 100 items.
5. Adapter не перечисляет repositories или Projects и обращается только к configured repository и явно заданному Project.
6. Octokit types и errors не протекают в command/domain contracts.
7. Authentication, forbidden, not found, rate limit и invalid response имеют deterministic diagnostics.
8. Fake adapter позволяет тестировать последующие workflow commands без process-level fake `gh api`.
9. `pnpm check` и `pnpm build` проходят.

## Validation

```bash
pnpm check
pnpm build
node dist/cli.js init --project test-owner/1 --dry-run --json
```

Последняя команда является opt-in smoke test и требует заранее подготовленного безопасного Project; она не входит в обычный test suite.

## Evidence required

- Contract tests credential redaction.
- REST repository fixture.
- Paginated ProjectV2 GraphQL fixture.
- Diagnostics fixtures для auth failure, forbidden, not found и rate limit.
- Сравнение observable `saf init` output до и после миграции.
- Подтверждение отсутствия mutating GitHub calls.

## Documentation impact

- Обновить README с GitHub authentication boundary.
- Если меняется обязательная роль `gh` или правило хранения credentials, сначала обновить `docs/saf-mvp.md`.
