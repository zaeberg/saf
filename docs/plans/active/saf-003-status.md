# SAF-003 — Stateless status derivation

## Dependencies

- SAF-002 завершён и принят.

## Goal

Реализовать read-only `saf status <issue>`, общий fact reader и pure state reducer, которые используются всеми последующими transition-командами.

## Non-goals

- Изменение Project Status.
- Запуск planner/executor/reviewer.
- Автоматическое исправление drift.

## State model

Состояния MVP: `Inbox`, `Shaping`, `Ready`, `Running`, `Review`, `Blocked`, `Done`, `Cancelled`.

Project Status является отображением, а не единственным источником истины. Reducer получает facts из Issue, Project item, approved-plan marker, Git branches, PR, checks, acceptance status и run markers.

## Tasks

### Task 1 — Fact types and readers

- Определить `WorkflowFacts` и source-specific fact types.
- Читать configured Issue и Project item.
- Читать approved-plan marker.
- Читать local/remote branch, PR, CI/checks и acceptance status.
- Не изменять внешнее состояние.

### Task 2 — Marker parsers

- Ввести versioned marker envelope.
- Парсить неизвестную version как diagnostic, не как валидный state.
- Обнаруживать conflicting duplicate markers.

### Task 3 — Pure reducer

- Реализовать deterministic state derivation.
- Возвращать blockers, drift findings и next action.
- Зафиксировать precedence rules в коде и документации.

### Task 4 — Status rendering

- Human status card.
- Stable `--json` output.
- Отдельно показывать Project Status и derived state.

## Required reducer scenarios

| Facts | Result |
|---|---|
| Issue без plan | Inbox/Shaping согласно evidence |
| Approved matching plan | Ready |
| Active run без PR | Running |
| Open PR | Review |
| Acceptance для старого SHA | Review + stale finding |
| Merged PR | Done или cleanup pending |
| Project=Done, PR не merged | Blocked + drift |
| Conflicting markers | Blocked |

## Acceptance criteria

1. Команда полностью read-only.
2. Удаление `.saf/runtime/` не мешает восстановить основное состояние.
3. Project Status и derived state выводятся отдельно.
4. Drift имеет стабильные machine-readable codes.
5. Все transition-команды смогут использовать тот же reducer без собственной state logic.
6. JSON output покрыт snapshot/shape tests.

## Validation

```bash
pnpm check
saf status 42 --json
```

## Evidence required

- Table-driven reducer tests.
- Integration fixtures минимум для `Inbox`, `Ready`, `Review`, stale acceptance и drift.
- Подтверждение отсутствия mutating GitHub calls.

