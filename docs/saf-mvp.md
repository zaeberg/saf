# SAF MVP

**Статус:** Proposed / зафиксированная граница первой реализации  
**Дата:** 12 июля 2026  
**Полная спецификация:** [local-agent-workflow-epic-spec.md](./local-agent-workflow-epic-spec.md)

## 1. Назначение

MVP должен автоматизировать уже проверенный вручную workflow одной Standard-задачи:

```text
GitHub Issue
→ интерактивные brainstorm и planning
→ planning:make со встроенным review плана
→ Ralphex + Codex
→ validation
→ Draft Pull Request
→ опциональный автоматический Ralphex review
→ CI и human code review в GitHub
→ ручной merge
```

MVP не является новой agent-платформой, системой управления проектами или автономным исполнителем. Это локальный stateless CLI, который связывает существующие инструменты и гарантирует обязательные переходы между стадиями.

Главный инвариант:

> Agent finished ≠ Work accepted.

## 2. Проверяемая ценность MVP

MVP считается полезным, если владелец может провести реальную задачу от существующего Issue до принятого Pull Request, не вспоминая вручную:

- как передать planner контекст задачи и проекта;
- где находится созданный plan;
- завершил ли planning:make подготовку плана;
- с какими параметрами запускать Ralphex и Codex;
- создан ли Draft Pull Request;
- прошли ли validation и CI;

CLI должен предотвращать небезопасный переход и объяснять, какое условие не выполнено.

## 3. Граница MVP

В MVP входят пять пользовательских команд:

```bash
saf init --project <owner/number>
saf shape <issue>
saf build <issue>
saf review <issue>
saf status <issue>
```

Все команды работают с одной задачей в текущем GitHub repository и с единственным GitHub Project, явно привязанным к нему через `.saf/config.yaml`. Одновременно допускается только один active implementation run в этом repository.

### 3.1. `saf init`

Команда инициализирует `saf` в текущем Git repository и создаёт явную связь с уже существующим GitHub Project.

Основной вызов:

```bash
saf init --project zbrg/5
```

Project передаётся явно как `<owner>/<number>`. CLI не перечисляет все Projects пользователя и не выбирает доску автоматически. Если аргумент не передан, допустим интерактивный ввод owner и number без API discovery.

Команда должна:

1. Проверить, что текущий каталог находится внутри Git repository.
2. Определить repository через `git remote get-url origin`.
3. Определить default branch.
4. Проверить наличие `gh` и GitHub authentication.
5. Проверить доступ к текущему GitHub repository и доступность Issues.
6. Проверить доступ к явно указанному GitHub Project.
7. Убедиться, что существующие Issue и Pull Request items Project принадлежат только текущему repository.
8. Найти обязательное поле `Status` и его options.
9. Проверить доступность Claude Code, Ralphex и Codex.
10. Предложить найденные validation commands и потребовать подтверждение итогового набора.
11. Создать tracked-файл `.saf/config.yaml`.
12. Создать локальную директорию `.saf/runtime/`.
13. Добавить `.saf/runtime/` и `.saf/config.local.yaml` в `.gitignore`.
14. Повторно загрузить конфигурацию и выполнить итоговую диагностику.

Повторный запуск должен быть идемпотентным: проверить существующую конфигурацию, показать drift и не перезаписывать корректные значения. Изменение связи с Project требует явного флага и подтверждения:

```bash
saf init --project zbrg/7 --rebind
```

В MVP `saf init` не создаёт GitHub repository или Project, не устанавливает внешние инструменты, не создаёт CI и Issue Forms, не меняет branch protection, не сохраняет credentials и не делает commit.

### 3.2. `saf shape <issue>`

Команда проводит задачу от GitHub Issue до approved plan.

Она должна:

1. Проверить Git repository, GitHub remote, Issue и доступность planner adapter.
2. Проверить, что Issue принадлежит configured repository и добавлен в configured GitHub Project.
3. Перевести Project item в `Shaping`.
4. Передать planner содержимое Issue и поручить ему сначала прочитать repository-local `AGENTS.md`, который содержит правила и ссылки на релевантную документацию.
5. Запустить Claude Code + GLM для интерактивного brainstorm.
6. Позволить человеку уточнить problem, desired outcome, non-goals и acceptance criteria.
7. Запустить `/planning:make` и получить plan-файл.
8. Доверять встроенному review loop `planning:make` и не запускать второй review из SAF.
9. Проверить минимальную обязательную структуру плана.
10. Нормализовать содержимое и вычислить SHA-256.
11. Опубликовать полное содержимое plan, revision, hash и original path в marker-комментарии GitHub Issue.
12. Перевести Project item в `Ready` и вывести следующую команду.

Brainstorm остаётся интерактивным. `saf` запускает planner с подготовленным контекстом, но не принимает продуктовые решения и не пытается автоматически завершить диалог вместо человека.

Дополнительный recovery/import режим:

```bash
saf shape <issue> --plan <path>
```

Он пропускает запуск planner и начинает с проверки уже существующего plan-файла.

### 3.3. `saf build <issue>`

Команда выполняет approved plan и создаёт review boundary.

Она должна:

1. Восстановить approved plan из Issue.
2. Проверить совпадение текущего plan hash с approved hash.
3. Проверить clean или допустимое состояние workspace.
4. Проверить отсутствие другого active run.
5. Проверить доступность и поддерживаемые версии Ralphex и Codex.
6. Перевести Project item в `Running`.
7. Запустить Ralphex с Codex в Standard mode.
8. Выполнить настроенные deterministic validation commands.
9. Push-нуть feature branch.
10. Идемпотентно создать или обновить Draft Pull Request.
11. Перевести Project item в `Review`, а при ошибке — в `Blocked`.
12. Опубликовать краткий run result и вывести следующее действие.

Повторный запуск не должен создавать вторую branch, второй run marker или второй Pull Request.

### 3.4. `saf review <issue>`

Команда запускает отдельный автоматический review pipeline Ralphex. Human review и merge остаются в GitHub.

Она должна:

1. Найти связанный open Pull Request, run branch и original plan.
2. Восстановить local/remote-only branch.
3. Запустить `ralphex --review --codex`.
4. Поддержать `--review-model` и `--external-review-tool`.
5. Выполнить configured validation и push branch без force.
6. Не публиковать human acceptance markers или commit statuses.

### 3.5. `saf status <issue>`

Команда восстанавливает состояние задачи из configured GitHub Project, Issue, Git и Pull Request без собственной постоянной базы данных.

Пример:

```text
Issue: #42
Project: zbrg / Project 5
Project status: Review
Derived state: Review
Plan: r2, approved, hash matches
Branch: feat/42-example
Pull Request: #51, Draft
CI: success
Next action: saf review 42 (optional), then review and merge in GitHub
```

Команда должна обнаруживать как минимум:

- отсутствующий или изменённый plan;
- прерванный build;
- существующую branch без Pull Request;
- конфликтующие или дублирующиеся marker-комментарии;
- Project item из другого repository;
- расхождение Project Status с проверяемыми GitHub/Git artifacts;
- недоступные обязательные внешние инструменты.

## 4. Источники истины

| Сущность | Каноническое место |
|---|---|
| Связь repository ↔ Project | `.saf/config.yaml` |
| Work item и acceptance criteria | GitHub Issue |
| Визуальный workflow status | Привязанный GitHub Project |
| Approved plan и hash | Marker-комментарий GitHub Issue |
| Реализация | Git branch |
| Review boundary | Draft Pull Request |
| Автоматическая проверка | CI checks |

Локальные cache, logs и lock-файлы в `.saf/runtime/` допустимы, но working plan всегда остаётся в original plans directory.

GitHub Project является обязательным repository-scoped workflow UI, но его `Status` не является самостоятельным доказательством готовности. CLI выводит effective state из Issue, plan marker, Git, Pull Request и CI, сравнивает его с Project Status и сообщает о drift.

Один configured repository связан ровно с одним configured GitHub Project. Project должен содержать items только этого repository. CLI не перечисляет другие repositories или Projects пользователя и не проверяет глобально, привязан ли тот же repository к другой доске.

## 5. Минимальная конфигурация repository

MVP использует tracked repository-local файл `.saf/config.yaml`. Секреты и runtime state в нём не хранятся.

```yaml
# .saf/config.yaml
version: 1

github:
  repository: zbrg/example
  project:
    owner: zbrg
    number: 5

repository:
  defaultBranch: main

documentation:
  plansDirectory: docs/plans

planning:
  adapter: claude-glm

execution:
  adapter: ralphex-codex
  maxConcurrentRuns: 1
  tasksOnly: false

review:
  adapter: ralphex-codex
  externalReviewTool: none

validation:
  commands:
    - pnpm lint
    - pnpm typecheck
    - pnpm test
```

`github.repository` сверяется с `git remote get-url origin`. Project node ID, field IDs и option IDs могут кэшироваться в `.saf/runtime/`, но должны быть повторно обнаруживаемы по конфигурации.

Рекомендуемая структура:

```text
.saf/
├── config.yaml       # tracked
└── runtime/          # ignored
```

Формат будет уточняться во время реализации. Неизвестные поля должны приводить к понятной диагностике, а не молча игнорироваться.

## 6. Минимальная внутренняя архитектура

```text
CLI commands
├── config
├── command runner
├── git adapter
├── GitHub adapter
├── GitHub Project adapter
├── planner adapter
├── plan parser and hash
├── Ralphex adapter
├── state derivation
└── GitHub adapter
```

Минимальные доменные сущности:

- `WorkItem`;
- `ProjectBinding`;
- `ProjectItem`;
- `ApprovedPlan`;
- `PullRequestRef`;
- `CheckSummary`;
- `HumanAcceptance`;
- `DerivedState`;
- `DriftFinding`.

Внутренняя архитектура должна позволять заменить внешний CLI через adapter, но MVP не требует универсального plugin framework.

## 7. Итерации реализации

Каждая итерация должна завершаться работающим проверяемым срезом, а не только внутренним scaffolding.

### Итерация 0 — CLI foundation

Результат: `saf init` безопасно привязывает реальный repository к существующему GitHub Project и создаёт валидный `.saf/config.yaml`.

- TypeScript CLI project;
- configuration schema и loader;
- command runner с streaming output и cancellation;
- `--dry-run`, `--verbose` и стабильные exit codes;
- secret redaction;
- базовые Git и GitHub preflight checks;
- чтение repository-scoped Project binding из `.saf/config.yaml`;
- GitHub Project lookup, field discovery и проверка repository isolation;
- реализация `saf init --project <owner/number>`;
- идемпотентная повторная инициализация;
- явный `--rebind` с подтверждением;
- создание `.saf/runtime/` и безопасное обновление `.gitignore`;
- подтверждение validation commands;
- unit- и integration-test harness.

### Итерация 1 — Issue → approved plan

Результат: `saf shape <issue>` создаёт проверенный и восстанавливаемый approved plan.

- загрузка planning context;
- запуск Claude Code + GLM;
- обнаружение созданного plan-файла;
- plan lint;
- доверие review loop внутри `planning:make`;
- нормализация и SHA-256;
- marker-комментарий;
- transitions Project Status `Shaping → Ready`;
- retrieval, duplicate detection и restore;
- `--plan <path>`.

### Итерация 2 — Approved plan → Draft PR

Результат: `saf build <issue>` идемпотентно превращает approved plan в Draft Pull Request.

- build preflight;
- active-run lock;
- Ralphex + Codex execution;
- deterministic validation;
- branch push;
- Draft Pull Request create/update;
- success/failure marker;
- transitions Project Status `Running → Review/Blocked`;
- базовые состояния `Ready`, `Running`, `Review` и `Blocked`.

### Итерация 3 — Automated review and GitHub handoff

Результат: `saf review <issue>` запускает отдельный Ralphex review, после чего human review и merge выполняются в GitHub.

- original plan и run branch;
- `ralphex --review --codex`;
- configurable review model;
- configurable external review tool;
- GitHub UI как human review boundary.

### Итерация 4 — Recovery and status

Результат: workflow восстанавливается после закрытия терминала, удаления cache и частично завершённой команды.

- `saf status <issue>`;
- derived state и next action;
- обнаружение drift между Project Status и фактическими artifacts;
- восстановление plan из Issue;
- продолжение или безопасный повтор build;
- восстановление branch без Pull Request;
- проверка идемпотентности основных команд.

После этой итерации MVP проходит проверку на 3–5 реальных Standard-задачах.

## 8. Что не входит в MVP

- cross-repository inbox и глобальный каталог Projects;
- создание нового Issue и Issue Forms;
- Fast и High-risk profiles;
- полноценный `saf doctor` как отдельная команда;
- создание GitHub repository или Project через `saf init`;
- автоматическая установка внешних инструментов;
- `saf fix`, `saf ship` и `saf clean`;
- автоматический merge;
- branch protection и ruleset management;
- автоматический documentation cleanup;
- whole-project health review;
- metrics dashboard;
- monorepo component profiles;
- worktrees и параллельные runs;
- background daemon и remote execution;
- local outbox для длительной GitHub outage;
- TUI или web UI;
- universal plugin framework;
- gstack integration.

Ручной merge остаётся обязательным. Перевод Draft Pull Request в Ready и cleanup после merge в MVP выполняются вручную.

## 9. Критерии готовности MVP

MVP готов к пилоту, если:

1. `saf init --project <owner/number>` определяет текущий GitHub repository и проверяет доступ к явно указанному Project.
2. `saf init` создаёт валидный tracked-файл `.saf/config.yaml` и ignored-директорию `.saf/runtime/`.
3. Повторный `saf init` не перезаписывает корректную конфигурацию, а смена Project невозможна без `--rebind` и подтверждения.
4. `.saf/config.yaml` однозначно связывает текущий repository с одним GitHub Project.
5. CLI не перечисляет и не изменяет другие repositories или Projects пользователя.
6. Items другого repository в configured Project обнаруживаются как configuration drift.
7. `saf shape` создаёт plan из контекста Issue через интерактивный planner workflow.
8. SAF доверяет завершённому `planning:make`, который отвечает за review плана.
9. Approved revision публикуется полностью и имеет воспроизводимый SHA-256.
10. Изменение plan после завершённого shape блокирует новый build.
11. `saf build` запускает Ralphex с Codex и создаёт ровно один Draft Pull Request.
12. Повторный запуск основных команд не создаёт дублирующих marker-комментариев, branch или Pull Request.
13. Неуспешные validation или execution переводят задачу и Project item в диагностируемое состояние `Blocked`.
14. `saf review` запускает Ralphex review с выбранной моделью и external review mode.
15. Human review и merge остаются в GitHub.
16. `saf status` показывает Project Status, derived state и drift без локальной постоянной базы.
17. Working plan остаётся в original plans directory и используется Ralphex напрямую.
18. Минимум одна искусственно прерванная задача успешно восстановлена.
19. Через MVP проведены 3–5 реальных Standard-задач.
20. Владелец подтверждает, что CLI уменьшает число ручных glue-действий и не делает workflow тяжелее ручного варианта.

## 10. Последующие итерации

Порядок определяется фактическим friction пилота, а не полнотой исходной спецификации.

Предварительный порядок:

1. `saf fix` и улучшенное recovery, если часто нужны исправления после review.
2. `saf clean`, если начинают накапливаться plans, branches и локальные artifacts.
3. Fast profile, если Standard lifecycle слишком тяжёл для малых изменений.
4. Расширенный onboarding через `saf init`, если понадобятся генерация CI, Issue Forms или bootstrap PR.
5. Repository-local `saf inbox`, если обычного GitHub Project UI окажется недостаточно.
6. Health review после стабилизации ежедневного lifecycle.
7. High-risk profile, worktrees и remote execution только по подтверждённой потребности.

Исходная epic specification остаётся каталогом полной целевой системы и возможных расширений. Этот документ является рабочей границей первой реализации.
