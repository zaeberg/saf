# SAF-007 — Recovery hardening and MVP pilot

## Dependencies

- SAF-006 завершён и принят.

## Goal

Подтвердить stateless recovery, идемпотентность всех команд и пригодность MVP на 3–5 реальных Standard-задачах.

## Non-goals

- Новые команды или profiles.
- Расширенный onboarding.
- Исправление любого неудобства без подтверждения повторяемости.

## Tasks

### Task 1 — Recovery matrix

Проверить и при необходимости исправить:

- удаление `.saf/runtime/`;
- прерывание `saf shape` до/после создания plan;
- прерывание Ralphex;
- успешный Ralphex без последующего PR;
- branch существует только local или remote;
- новый commit после acceptance;
- неверный ручной Project Status;
- conflicting marker comments;
- marker comments с повреждённым hidden envelope при сохранённой visible части;
- human-readable presentation approved-plan, run и human-acceptance markers;
- временная недоступность GitHub API.

### Task 2 — Idempotency matrix

- Повторить `init`, `status`, `shape`, `build`, `review` на каждом допустимом terminal/partial state.
- Убедиться в отсутствии duplicate config entries, comments, branches, PR и statuses.
- Подтвердить, что все marker comments созданы общим serializer, читаются общим parser и содержат понятный visible summary.

### Task 3 — Security and scope audit

- Подтвердить отсутствие API discovery других repositories/Projects.
- Проверить redaction logs и runtime artifacts.
- Проверить отсутствие shell interpolation для внешних commands.

### Task 4 — Real pilot

- Провести 3–5 Standard-задач.
- Для каждой записать duration, ручные обходы, failures, review findings и субъективный friction.
- Минимум одну задачу искусственно прервать и восстановить.

### Task 5 — MVP decision

- Сопоставить результаты с критериями `docs/saf-mvp.md`.
- Создать только evidence-backed follow-up Issues.
- Зафиксировать решение: MVP accepted, needs one hardening iteration или rejected.

## Acceptance criteria

1. Все recovery/idempotency scenarios имеют автоматический либо документированный manual test.
2. Удаление runtime не уничтожает approved plan, PR relation или derived state.
3. Нет операций с другими configured contexts пользователя.
4. Через CLI проведены 3–5 реальных задач.
5. Хотя бы один interrupted run восстановлен.
6. Владелец подтверждает приемлемый review cost.
7. Follow-up backlog основан на наблюдаемом friction пилота.
8. Marker comments одновременно обеспечивают canonical recovery и понятную человеку GitHub timeline.

## Validation

```bash
pnpm check
pnpm build
```

Дополнительно выполнить manual recovery matrix и сохранить sanitized pilot report.

## Evidence required

- Recovery/idempotency test matrix.
- Marker presentation matrix для approved-plan, run lifecycle и acceptance history.
- Sanitized pilot report.
- Итоговое go/harden/stop решение.
