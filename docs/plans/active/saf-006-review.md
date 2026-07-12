# SAF-006 — Human review and SHA-bound acceptance

## Dependencies

- SAF-005 завершён и принят.

## Goal

Реализовать `saf review <issue>`, который проверяет текущий Draft PR, открывает revdiff и публикует human acceptance только для текущего head SHA.

## Non-goals

- Автоматическое исправление annotations.
- Merge или перевод PR в Ready.
- GitHub approval другого пользователя.

## Contracts to freeze

- Review packet schema v1.
- Human-acceptance evidence marker v1.
- Severity mapping annotations: blocking/non-blocking.
- Commit status context `saf/human-acceptance`.

## Tasks

### Task 1 — Review preflight

- Получить facts через общий reader.
- Проверить open Draft PR, current head SHA и CI result.
- Запретить acceptance для failed/pending required CI.

### Task 2 — Review packet

- Включить Issue/outcome, criteria, plan revision/hash, changed files, validation, manual checks, deviations и limitations.
- Сохранять временный packet только в `.saf/runtime/review/`.

### Task 3 — revdiff adapter

- Открыть текущий diff.
- Получить structured annotations и exit code.
- Блокировать acceptance при blocking findings.

### Task 4 — Human confirmation

- Показать acceptance checklist.
- Потребовать typed current SHA.
- Повторно прочитать remote head непосредственно перед публикацией.

### Task 5 — Publish acceptance

- Опубликовать commit status для exact SHA.
- Добавить versioned evidence comment в PR.
- Не переводить Project item в `Done` до merge.

## Acceptance criteria

1. Failed/pending CI блокирует acceptance.
2. Blocking annotation блокирует acceptance.
3. Неверно введённый SHA блокирует acceptance.
4. Изменение head SHA во время review блокирует публикацию.
5. Status публикуется только для подтверждённого current SHA.
6. Новый commit обнаруживается как stale acceptance командой `saf status`.
7. Review packet не становится каноническим локальным состоянием.

## Validation

```bash
pnpm check
saf review 42 --dry-run
```

## Evidence required

- Integration tests всех blocking сценариев.
- Проверка exact SHA в fake GitHub status request.
- Manual live review и acceptance smoke test.

