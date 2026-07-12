# SAF-004 — Issue to approved plan

## Dependencies

- SAF-003 завершён и принят.

## Goal

Реализовать `saf shape <issue>`, который запускает интерактивное planning, проводит plan review и публикует точную approved revision.

## Non-goals

- Автономное принятие product framing.
- Выполнение implementation plan.
- Поддержка иных planner adapters кроме Claude Code + GLM.

## Contracts to freeze

Approved-plan marker v1 должен содержать Issue, revision, normalization version, SHA-256 и полный plan. До первого live использования зафиксировать normalization fixtures: LF, trailing whitespace и final newline.

## Tasks

### Task 1 — Shape guard and context

- Использовать state reducer и разрешённые starting states.
- Проверить Issue/repository/Project consistency.
- Собрать Issue, `PROJECT.md`, `AGENTS.md`, config и релевантный repository context.
- Перевести Project item в `Shaping` только после preflight.

### Task 2 — Planner adapter

- Запустить Claude Code + GLM с подготовленным контекстом.
- Сохранить интерактивность brainstorm.
- Обнаружить созданный plan path и корректно обработать cancellation/failure.

### Task 3 — Plan parser and lint

- Проверить обязательные sections, tasks, validation commands и placeholders.
- Реализовать `--plan <path>` для import/recovery.

### Task 4 — Review and approval

- Открыть plan через revdiff.
- Поддержать annotations/revision loop.
- Потребовать явное human confirmation.
- Нормализовать plan и вычислить SHA-256.

### Task 5 — Publish and transition

- Идемпотентно опубликовать marker comment.
- Обнаруживать duplicate/conflicting revision.
- Перевести Project item в `Ready` после успешной публикации.

## Acceptance criteria

1. Issue проходит путь `Shaping → Ready` только после plan review и confirmation.
2. Plan можно восстановить из Issue без локального файла.
3. Один и тот же normalized content даёт стабильный hash.
4. Изменённый plan не совпадает с approved hash.
5. Повторная публикация не создаёт duplicate marker.
6. Planner/revdiff failure не переводит задачу в `Ready`.

## Validation

```bash
pnpm check
saf shape 42 --plan fixtures/plans/valid.md --dry-run
```

## Evidence required

- Normalization/hash fixtures.
- Marker round-trip tests.
- Integration test успешного и прерванного shape.
- Manual live smoke plan approval.

