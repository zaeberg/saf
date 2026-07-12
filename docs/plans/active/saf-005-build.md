# SAF-005 — Approved plan to Draft Pull Request

## Dependencies

- SAF-004 завершён и принят.

## Goal

Реализовать идемпотентный `saf build <issue>`, который выполняет approved plan через Ralphex + Codex, валидирует результат и создаёт один Draft PR.

## Non-goals

- Fast/High-risk profiles.
- Worktrees и параллельные runs.
- Исправления после human review.
- Merge или перевод PR в Ready.

## Tasks

### Task 1 — Build transition guard

- Получить facts через общий reader/reducer.
- Разрешать новый build только из `Ready`.
- Проверить approved plan hash, clean workspace и отсутствие active run.

### Task 2 — Run marker and locking

- Определить versioned run marker и idempotency key.
- Создать локальный process lock в `.saf/runtime/`.
- Публиковать recoverable start/success/failure evidence.
- Перевести Project item в `Running` после успешного preflight.

### Task 3 — Ralphex/Codex adapter

- Проверить versions/auth.
- Запустить Standard full mode с exact approved plan.
- Stream output, обрабатывать cancellation и exit codes.

### Task 4 — Validation and Git

- Выполнить configured validation commands последовательно.
- Зафиксировать command, exit code и timestamp без secrets.
- Проверить результирующую branch и commits.
- Push branch без force.

### Task 5 — Draft PR

- Найти существующий PR по stable issue/branch relation.
- Создать либо обновить ровно один Draft PR.
- Добавить build evidence и approved plan reference.
- Перевести Project item в `Review`; failure — в `Blocked`.

## Recovery decisions

Повторный запуск сначала восстанавливает facts и выбирает одно действие: no-op, продолжить run, повторить validation, push существующей branch, создать отсутствующий PR либо остановиться при неоднозначности.

## Acceptance criteria

1. Build невозможен без matching approved plan.
2. Одновременно существует не больше одного active run repository.
3. Повторный запуск не создаёт duplicate branch/marker/PR.
4. Validation failure не создаёт accepted review state и переводит item в `Blocked`.
5. Успех создаёт Draft PR и Project Status `Review`.
6. Команда никогда не выполняет merge, force push или destructive cleanup.

## Validation

```bash
pnpm check
saf build 42 --dry-run
```

## Evidence required

- Fake-executable integration tests Ralphex success/failure/cancel.
- Validation evidence fixture.
- Tests повторного запуска на каждом partial state.
- Manual live Draft PR smoke test.

