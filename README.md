# SAF

SAF — opinionated локальный CLI для безопасной работы с coding agents. Он связывает GitHub Issues, GitHub Project, Git, Claude Code, Ralphex, Codex и revdiff в один воспроизводимый workflow:

```text
GitHub Issue
→ brainstorm и планирование
→ review и утверждение точной версии плана
→ реализация через Ralphex + Codex
→ validation
→ Draft Pull Request и CI
→ human review
→ acceptance для точного commit SHA
→ ручной merge
```

SAF не является ещё одним coding agent. Он не пишет код сам, не заменяет GitHub и не принимает продуктовые решения за человека. Его задача — управлять переходами между уже существующими инструментами, сохранять проверяемые evidence и не позволять случайно пропустить важный этап.

> Agent finished ≠ Work accepted.

Проект находится на стадии MVP и готовится к реальному пилоту. Основной lifecycle реализован и покрыт автоматическими recovery/idempotency-тестами, но итоговое решение о пригодности будет принято после 3–5 настоящих end-to-end задач.

## Зачем нужен SAF

Работа с coding agents обычно окружена большим количеством ручного glue-кода и договорённостей:

- передать planner контекст Issue и проекта;
- не потерять итоговый план и убедиться, что выполняется именно утверждённая версия;
- правильно запустить coding agent и validation;
- связать branch, Pull Request и исходный Issue;
- не принять результат до успешного CI и человеческого review;
- повторить review после нового commit;
- восстановить процесс после закрытия терминала или прерванного запуска.

Когда эти шаги хранятся только в памяти человека, workflow легко обойти случайно. SAF делает их явными, проверяемыми и восстанавливаемыми.

## Идея и философия

### GitHub и Git остаются источниками истины

SAF не использует собственную постоянную базу данных. Каноническое состояние хранится там, где разработчик и так ожидает его увидеть:

| Данные | Источник истины |
|---|---|
| Задача и ожидаемый результат | GitHub Issue |
| Визуальный статус работы | GitHub Project |
| Утверждённый план | Marker-комментарий в Issue |
| Реализация | Git branch |
| Review boundary | Draft Pull Request |
| Автоматические проверки | CI checks |
| Человеческая приёмка | Commit status текущего SHA |

`.saf/runtime/` содержит только временные файлы, review packets и lock. Его можно удалить без потери approved plan, связи с PR или вычисляемого состояния задачи.

### Человек остаётся в контуре

SAF автоматизирует orchestration, но не автоматизирует ответственность:

- человек уточняет задачу и утверждает план;
- человек просматривает diff;
- acceptance привязывается к точному SHA;
- merge всегда выполняется вручную.

### Evidence важнее надписи в колонке

GitHub Project Status используется как удобный UI, но не считается доказательством готовности. `saf status` вычисляет реальное состояние по Issue, markers, Git branch, PR, CI и acceptance, а затем показывает расхождения с Project.

### Fail closed и безопасное восстановление

Повреждённые или конфликтующие markers, failed CI, изменившийся SHA и blocking annotations останавливают переход. Повторный запуск команды продолжает допустимый partial state и не должен создавать duplicate comments, branches, PR или statuses.

## Что входит в MVP

В текущей версии доступны пять команд:

| Команда | Назначение |
|---|---|
| `saf init` | Привязать repository к существующему GitHub Project |
| `saf status <issue>` | Восстановить и показать фактическое состояние задачи |
| `saf shape <issue>` | Превратить Issue в проверенный approved plan |
| `saf build <issue>` | Выполнить approved plan и создать Draft PR |
| `saf review <issue>` | Провести human review и принять точный head SHA |

SAF работает с одним текущим repository и одним явно настроенным GitHub Project. Одновременно допускается один implementation run на repository.

## Требования

Для запуска нужны:

- Linux или macOS;
- Node.js `22.13+`;
- pnpm `10`;
- Git;
- [GitHub CLI (`gh`)](https://cli.github.com/) с выполненным `gh auth login`;
- Claude Code с настроенным GLM workflow для brainstorm/planning;
- Ralphex с native Codex mode;
- авторизованный Codex CLI;
- revdiff;
- GitHub repository с включёнными Issues;
- существующий repository-scoped GitHub Project.

В GitHub Project должно быть single-select поле `Status` со значениями:

```text
Backlog
Shaping
Ready
Running
Review
Blocked
Done
```

Project должен содержать items только текущего repository. SAF не создаёт Project, CI, Issues или branch protection автоматически.

## Установка

Пакет пока не опубликован в npm. Установка выполняется из исходников:

```bash
git clone git@github.com:zaeberg/saf.git
cd saf
pnpm install
pnpm build
pnpm link --global
```

Проверка:

```bash
saf --version
saf --help
```

Если глобальный bin-каталог pnpm ещё не настроен, выполните `pnpm setup`, перезапустите shell и повторите `pnpm link --global`.

Без глобальной установки CLI можно запускать прямо из repository SAF:

```bash
node dist/cli.js --help
```

## Быстрый старт

### 1. Подготовьте GitHub

Создайте или выберите GitHub Project, добавьте обязательные значения `Status` и поместите в него Issue из текущего repository.

Проверьте авторизацию:

```bash
gh auth status
codex login status
```

### 2. Инициализируйте repository

Перейдите в repository проекта, которым хотите управлять:

```bash
cd /path/to/your-project
saf init --project <owner>/<project-number> \
  --validation "pnpm lint" \
  --validation "pnpm typecheck" \
  --validation "pnpm test" \
  --yes
```

Например:

```bash
saf init --project zaeberg/5 --validation "pnpm check" --yes
```

Команда создаст:

```text
.saf/
├── config.yaml    # tracked-конфигурация repository
└── runtime/       # ignored-временные данные
```

Также в `.gitignore` будут добавлены `.saf/runtime/` и `.saf/config.local.yaml`.

### 3. Проведите задачу через lifecycle

```bash
saf status 42
saf shape 42
saf build 42 --dry-run
saf build 42
saf review 42 --dry-run
saf review 42
```

После успешного review переведите Pull Request из Draft в Ready при необходимости и выполните merge вручную.

## Команды

### `saf init`

Привязывает текущий Git repository к существующему GitHub Project и создаёт `.saf/config.yaml`.

```bash
saf init --project <owner>/<number> [options]
```

Опции:

- `--project <owner/number>` — обязательная явная ссылка на Project;
- `--validation <command>` — validation command; можно повторять;
- `--rebind` — разрешить смену уже настроенного Project;
- `--yes` — подтвердить validation commands или rebind без интерактивного вопроса;
- `--dry-run` — выполнить проверки без записи файлов.

Повторный запуск с тем же binding идемпотентен. SAF не перечисляет все Projects пользователя и не выбирает Project автоматически.

### `saf status <issue>`

Read-only команда, которая восстанавливает workflow state из GitHub и Git:

```bash
saf status 42
saf status 42 --json
```

Вывод включает:

- Project Status и derived state;
- approved plan revision и hash;
- branch и Pull Request;
- CI result;
- acceptance для текущего SHA;
- drift findings, blockers и следующую команду.

Основные derived states: `Inbox`, `Shaping`, `Ready`, `Running`, `Review`, `Blocked`, `Done`, `Cancelled`.

### `saf shape <issue>`

Запускает интерактивный brainstorm/planning через Claude Code + GLM, проверяет структуру плана, открывает его в revdiff и требует явного approval:

```bash
saf shape 42
```

После approval SAF публикует в Issue human-readable marker с полной версией плана, revision и SHA-256, затем переводит Project item в `Ready`.

Для импорта или восстановления существующего плана:

```bash
saf shape 42 --plan docs/plans/active/issue-42.md
saf shape 42 --plan docs/plans/active/issue-42.md --yes
saf shape 42 --plan docs/plans/active/issue-42.md --dry-run
```

`--yes` подтверждает reviewed plan в non-interactive режиме. Он не отменяет lint и revdiff review.

### `saf build <issue>`

Выполняет точный approved plan через Ralphex + Codex:

```bash
saf build 42 --dry-run
saf build 42
```

Команда:

1. проверяет approved plan, workspace, инструменты и active-run lock;
2. публикует recoverable run marker и переводит item в `Running`;
3. запускает Ralphex в native Codex mode;
4. последовательно выполняет validation commands без shell interpolation;
5. проверяет branch и commits;
6. push-ит feature branch без force;
7. создаёт или обновляет один Draft Pull Request;
8. переводит item в `Review` либо в `Blocked` при ошибке.

Повторный запуск восстанавливает допустимые partial states: повторяет прерванное execution, продолжает после успешного Ralphex без PR и восстанавливает local или remote-only run branch.

### `saf review <issue>`

Проводит human review текущего Draft PR и публикует acceptance только для просмотренного head SHA:

```bash
saf review 42 --dry-run
saf review 42
```

SAF требует успешный CI, проверяет совпадение local branch с remote PR head, формирует временный review packet и открывает diff в revdiff.

Severity annotations задаётся префиксом:

```text
[blocking] Это необходимо исправить до acceptance.
[non-blocking] Это можно сделать отдельно.
```

Аннотация без префикса считается blocking. Перед публикацией нужно ввести полный текущий SHA. Для non-interactive запуска:

```bash
saf review 42 --sha <full-head-sha>
```

Непосредственно перед публикацией SAF повторно читает remote head. При успехе в PR появляется human-readable acceptance marker, а для commit создаётся status `saf/human-acceptance`. Любой новый commit делает предыдущее acceptance устаревшим.

## Общие опции

```text
--json       машинно-читаемый JSON output
--dry-run    проверить действие без GitHub/Git workflow mutations
--verbose    зарезервированный флаг подробного вывода
--help       справка
--version    версия
```

Примеры:

```bash
saf status 42 --json
saf build 42 --dry-run
saf review 42 --dry-run --json
```

Стабильные exit codes:

| Код | Значение |
|---:|---|
| `0` | Успех |
| `1` | Внутренняя ошибка |
| `2` | Некорректный вызов или запрещённый переход |
| `3` | Некорректная конфигурация |
| `4` | Отсутствующая зависимость, auth или access |
| `5` | Ошибка внешней команды, API или validation |
| `130` | Отмена команды |

## Конфигурация

Пример `.saf/config.yaml`:

```yaml
version: 1

github:
  repository: zaeberg/example
  project:
    owner: zaeberg
    number: 5

repository:
  defaultBranch: main

documentation:
  projectFile: PROJECT.md
  agentsFile: AGENTS.md
  plansDirectory: docs/plans/active

planning:
  adapter: claude-glm

execution:
  adapter: ralphex-codex
  maxConcurrentRuns: 1

review:
  adapter: revdiff

validation:
  commands:
    - pnpm lint
    - pnpm typecheck
    - pnpm test
```

Секреты в config не хранятся. GitHub token читается через `gh` только в память процесса. Неизвестные поля и несовпадение repository с `origin` считаются ошибкой.

## Recovery и markers

SAF публикует versioned markers с двумя слоями:

- скрытый canonical envelope для машинного восстановления;
- обычный Markdown summary для читаемой GitHub timeline.

Используются markers:

- `approved-plan` — revision, SHA-256 и полный утверждённый plan;
- `run` — lifecycle запуска, branch, run ID и PR;
- `human-acceptance` — exact commit SHA и timestamp.

Повреждённый hidden envelope не принимается как evidence, даже если видимая часть сохранилась. Конфликтующие markers переводят derived state в `Blocked`.

Подробная recovery/idempotency matrix и runbook: [docs/recovery-and-pilot.md](docs/recovery-and-pilot.md).

## Ограничения MVP

Текущая версия намеренно не делает следующее:

- не создаёт GitHub repository, Project, Issue Forms или CI;
- не устанавливает внешние инструменты;
- не выполняет auto-merge и не переводит PR в Ready;
- не делает cleanup после merge;
- не поддерживает несколько repositories/Projects одновременно;
- не поддерживает worktrees и параллельные runs;
- не имеет background daemon, TUI или web UI;
- не реализует Fast/High-risk profiles, `saf fix`, `saf clean` и health review.

## Разработка

```bash
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
```

Отдельные проверки:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Документация

- [Граница и контракты MVP](docs/saf-mvp.md)
- [Полная спецификация workflow](docs/local-agent-workflow-epic-spec.md)
- [Правила вычисления status](docs/status-derivation.md)
- [Recovery matrix и pilot gate](docs/recovery-and-pilot.md)

## Статус проекта

Технический MVP реализован. Автоматические recovery/idempotency/security проверки проходят, но реальный pilot ещё не завершён. До появления evidence по 3–5 Standard-задачам проект следует считать экспериментальным инструментом для контролируемого использования, а не готовым production-продуктом.
