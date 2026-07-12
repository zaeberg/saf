# SAF-002 — Repository initialization

## Dependencies

- SAF-001 завершён и принят.

## Goal

Реализовать идемпотентный `saf init --project <owner/number>`, который связывает текущий Git repository с одним существующим GitHub Project и создаёт `.saf/config.yaml`.

## Non-goals

- Создание GitHub repository или Project.
- Перечисление Projects пользователя.
- Установка внешних CLI.
- Создание CI, Issue Forms, branch rules или commit.

## Technical approach

Команда получает Project только явно. GitHub interaction выполняется через `gh` adapter с argv-вызовами и typed parsing. Project node/field IDs разрешено кэшировать только в `.saf/runtime/`.

## Tasks

### Task 1 — Git repository context

- Найти repository root.
- Разобрать GitHub slug из `origin` SSH/HTTPS URL.
- Определить default branch.
- Читать и безопасно дополнять `.gitignore`.

### Task 2 — GitHub preflight

- Проверить наличие `gh` и auth.
- Проверить доступ к configured repository и Issues.
- Не вызывать API перечисления repositories или Projects.

### Task 3 — Project binding

- Разобрать `<owner>/<number>`.
- Получить указанный Project через GraphQL.
- Найти поле `Status` и обязательные options MVP.
- Проверить, что Issue/PR items принадлежат текущему repository.
- Вернуть `PROJECT_REPOSITORY_DRIFT` при чужих items.

### Task 4 — Tool and validation discovery

- Проверить `claude`, `ralphex`, `codex`, `revdiff`.
- Найти вероятные validation scripts без автоматического утверждения.
- В interactive mode получить подтверждение; в non-interactive mode потребовать явные options/config input.

### Task 5 — Filesystem initialization

- Создать `.saf/config.yaml` атомарно.
- Создать `.saf/runtime/`.
- Добавить `.saf/runtime/` и `.saf/config.local.yaml` в `.gitignore` без дублей.

### Task 6 — Re-init and rebind

- Повторный init валидирует существующую связь и не переписывает файл.
- Несовпадающий Project блокируется без `--rebind`.
- `--rebind` показывает old/new binding и требует confirmation.

## Acceptance criteria

1. Успешный init создаёт валидный tracked config и ignored runtime directory.
2. CLI обращается только к текущему repository и явно заданному Project.
3. Project с чужими repository items блокирует init.
4. Отсутствующее поле `Status` даёт actionable diagnostic.
5. Повторный init не меняет файлы.
6. Rebind невозможен без flag и confirmation.
7. Credentials не записываются в `.saf`.

## Tests

- Unit: remote URL parsing, project reference parsing, gitignore merge.
- Contract fixtures: `gh auth`, repository response, Project GraphQL response.
- Integration: temporary Git repositories и fake `gh` executable.
- Один manual live smoke test на отдельном repository/Project.

## Validation

```bash
pnpm check
saf init --project test-owner/1 --dry-run
```

## Evidence required

- Созданный sanitized config.
- Повторный init без diff.
- Diagnostics для inaccessible Project, foreign item и missing Status.

