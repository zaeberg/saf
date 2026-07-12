# SAF MVP recovery and pilot evidence

Этот документ фиксирует проверяемую матрицу SAF-007. Автоматические строки подтверждаются тестами репозитория. Manual pilot нельзя считать пройденным до заполнения отчёта реальными наблюдениями владельца.

## Recovery matrix

| Scenario | Expected result | Evidence |
|---|---|---|
| `.saf/runtime/` удалён | `status` восстанавливает `Ready` из GitHub/Git | `test/status-integration.test.ts` |
| `shape` прерван до plan | Item остаётся `Shaping`, повтор разрешён | `test/shape-integration.test.ts` planner failure |
| plan создан, marker ещё не опубликован | Plan можно повторно импортировать через `--plan` | `test/shape-integration.test.ts` imported-plan flow; manual interrupt |
| approved marker опубликован, Status не обновлён | Повторный `shape --plan` не создаёт comment и исправляет Status | `test/shape-integration.test.ts` idempotent approved plan |
| Ralphex прерван | Failed run сохраняет phase; повтор выполняет execution заново | `test/build-execution.test.ts`, `test/build-integration.test.ts` |
| Ralphex завершён, PR отсутствует | Повтор пропускает Ralphex и продолжает validation/push/PR | `test/build-integration.test.ts` recovery flow |
| Run branch существует local, но не checkout | SAF безопасно переключается на неё | `test/build-git.test.ts` |
| Run branch существует только remote | SAF выполняет fetch и создаёт tracking branch без force | `test/build-git.test.ts` |
| После acceptance появился commit | Acceptance становится stale для нового SHA | `test/reducer.test.ts` |
| Project Status изменён вручную | Derived state сохраняется, показывается drift | `test/reducer.test.ts` |
| Marker comments конфликтуют | Workflow блокируется | `test/markers.test.ts`, `test/reducer.test.ts` |
| Hidden envelope повреждён, visible summary сохранён | Visible текст остаётся читаемым, marker не принимается как evidence | `test/markers.test.ts` |
| GitHub временно недоступен | Ошибка нормализуется без утечки transport details | `test/github-adapter.test.ts` |

## Idempotency matrix

| Command | Terminal/partial repeat | Expected result | Evidence |
|---|---|---|---|
| `init` | existing matching binding | config и `.gitignore` не дублируются | `test/init-integration.test.ts`, `test/init-contracts.test.ts` |
| `status` | любое состояние | read-only, одинаковые facts дают одинаковый report | `test/status-integration.test.ts` |
| `shape` | matching approved plan | один canonical comment, revision не растёт | `test/shape-integration.test.ts` |
| `build` | Review либо execution-complete partial | no-op либо продолжение без duplicate Ralphex/PR/marker | `test/build-integration.test.ts` |
| `review` | status уже существует для current SHA | no-op без revdiff/comment/status mutation | `test/review-integration.test.ts` |

Marker presentation отдельно проверяется в `test/markers.test.ts`: approved plan содержит полный plan, run показывает lifecycle/branch/PR, acceptance показывает exact SHA; acceptance разных SHA сохраняется как история.

## Security and scope audit

- Все GitHub вызовы получают только repository и Project из `.saf/config.yaml`; discovery других Projects отсутствует.
- Project reader проверяет foreign repository items и прекращает работу при scope drift.
- GitHub token читается из `gh auth token` в память, не записывается в config/runtime и проверяется redaction-тестами.
- External commands выполняются через argv с `shell: false`; validation использует `string-argv`, но не shell interpolation.
- Runtime содержит только восстанавливаемые plan/review artifacts и process lock; `.saf/runtime/` игнорируется Git.
- Build recovery не использует force push, reset, clean или destructive cleanup.

Evidence: `test/github-auth.test.ts`, `test/command-runner.test.ts`, `test/build-execution.test.ts`, `test/build-git.test.ts`, `test/github-adapter.test.ts`, `test/github-transport.test.ts`.

## Manual recovery checks

Перед pilot один раз выполнить на disposable Standard-задаче:

1. Прервать `saf shape` после появления plan, затем восстановить через `saf shape <issue> --plan <path>`.
2. Прервать Ralphex во время `saf build`, проверить failed run comment и повторить `saf build <issue>`.
3. После успешного build удалить `.saf/runtime/` и проверить `saf status <issue>`.
4. После acceptance добавить новый commit и убедиться, что `saf status` показывает stale acceptance.
5. Временно установить неверный Project Status и проверить drift без потери evidence-derived state.

## Pilot report

Status: **not run**. Заполнить 3–5 строк только после реального прохождения Standard-задач.

| Issue/PR | Duration | Interrupted/recovered | Manual workarounds | Failures | Review findings | Friction (1–5) |
|---|---:|---|---|---|---|---:|
| pending | — | — | — | — | — | — |
| pending | — | — | — | — | — | — |
| pending | — | — | — | — | — | — |
| optional | — | — | — | — | — | — |
| optional | — | — | — | — | — | — |

Sanitization: не включать tokens, private URLs, customer data, полный proprietary diff или несокращённые command logs.

## MVP decision gate

Текущее решение: **pending pilot**.

После pilot выбрать ровно одно:

- `accepted` — 3–5 задач завершены, interrupted run восстановлен, review cost приемлем владельцу;
- `harden` — core workflow работает, но повторяемый friction требует одной ограниченной итерации;
- `stop` — workflow не даёт достаточной пользы или recovery ненадёжен.

Follow-up Issues создаются только для проблемы, наблюдавшейся минимум дважды, либо для одного safety/data-loss дефекта. Владелец отдельно фиксирует подтверждение приемлемого review cost.
