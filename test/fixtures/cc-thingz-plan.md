# Немутирующий repository confidence gate (Issue #25)

Status: draft (ожидает human review)
Date: 2026-07-12
Issue: #25
Depends on: #22 (CLOSED — блокер снят)

## Overview

Корневой `pnpm check` сейчас мутирует рабочие файлы: он вызывает `pnpm format`
(`prettier --write`). Это ломает идею confidence gate — повторный запуск на чистом
checkout не должен менять `git status`. Кроме того, в репозитории нет GitHub Actions
workflow, который независимо прогоняет обязательные проверки на Pull Request.

Решение — два точечных изменения:

1. **`pnpm check` становится немутирующим**: использует `format:check` вместо `format`.
   Скрипт `format` (write) остаётся доступным разработчику (AC #2).
2. **CI workflow `.github/workflows/check.yml`** с одним стабильным job `check`,
   который ставит зависимости из lockfile и запускает **тот же** `pnpm check` на PR.

Плюс минимальная инфраструктура воспроизводимости: `.nvmrc` (единый источник правды
для Node-версии) и `engines.node` в `package.json`. Документация контракта гейта —
в `docs/engineering/testing-strategy.md`.

Интеграция локальна: меняются только `package.json`, новый `.nvmrc`, новый workflow и
один док-файл. Код пакетов не затрагивается.

## Context (from discovery)

- `package.json:7` — `"check": "pnpm format && pnpm typecheck && pnpm lint && pnpm test"` (мутирует через `format`).
- `package.json:8-9` — `"format": "prettier "**/*.{js,ts}" --write"`, `"format:check": "prettier "**/*.{js,ts}" --check"` (нужный скрипт уже существует).
- `package.json:5` — `"packageManager": "pnpm@10.0.0"`; поля `engines` нет.
- `prettier.config.js` — `printWidth: 100`, `trailingComma: "none"`. Важно: prettier гоняется **только по `*.{js,ts}`** — `*.json`, `*.yml`, `*.md` гейтом не проверяются (не расширять scope, вне задачи).
- `.github/workflows/` — не существует (есть только `.github/ISSUE_TEMPLATE`).
- Текущее состояние (проверено немутирующе): `format:check`, `typecheck`, `lint`, `test` (418 тестов) — зелёные. `pnpm-lock.yaml` присутствует.
- Локальный runtime: `node v26.2.0`, `pnpm 10.0.0`. `.nvmrc` / `.node-version` отсутствуют.
- `docs/engineering/testing-strategy.md`, секция **Quality Gates** — место контракта гейта (AC #5/#8).
- Issue #22 (зависимость) — **CLOSED**, поэтому AC #7 достижим.

## Development Approach

- **Testing approach**: Regular. План **config/infra/docs**, прикладного кода нет → unit-тестов нет.
  Аналогом «теста» для каждой задачи служит её **validation command** + требование
  «чистый `git status` до и после `pnpm check`». Это явно зафиксировано в каждой задаче.
- Малые атомарные изменения; одна задача — одна область (`package.json` / `.nvmrc` / workflow / docs).
- Каждая задача завершается прогоном validation-команды из `## Validation Commands`; переход к следующей — только при зелёном результате.
- Backward compatibility: публичные API пакетов, test framework, deployment не затрагиваются.
- `/fixtures` — hands-off (см. `.claude/planning-rules.md`, AGENTS.md); план его не трогает.

## Testing Strategy

- **Без unit/contract/golden-тестов**: нет изменений в коде `packages/*` / `apps/*`.
- **Validation вместо тестов**:
  - `pnpm format:check` — проверка, что репо отформатировано (AC #1/#6).
  - `pnpm check` — итоговый немутирующий гейт (AC #1/#4).
  - `git status --porcelain` пуст до и после `pnpm check` — доказательство немутируемости (AC #6).
  - Синтаксис workflow: `actionlint` если установлен; иначе — YAML-parse и фактический прогон на PR (Post-Completion).
- **E2E (внешний)**: зелёный run job `check` в GitHub Actions на PR (AC #7) — см. Post-Completion.

## Progress Tracking

- `[x]` — выполнено; ➕ — появилось в ходе; ⚠️ — блокер/проблема. Держать план в синхроне с реальностью.

## Solution Overview

- `pnpm check` репоинтится на `format:check`: `"pnpm format:check && pnpm typecheck && pnpm lint && pnpm test"`.
  Скрипт `format` (write) сохраняется для ручного применения форматирования (AC #2).
- Node-пин: новый `.nvmrc` = `24` (активная LTS) как единый источник правды; `engines.node = ">=24"`
  в `package.json` (допускает локальный Node 26; CI пинится на 24 через `.nvmrc`).
- Workflow `.github/workflows/check.yml`: trigger `pull_request` (только PR, без `push: master`),
  один job `check`. Steps: `checkout@v4` → `pnpm/action-setup@v4` (читает `packageManager`) →
  `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm check`.
- Имя required job — **`check`**. В GitHub required-status check будет отображаться как
  `check / check` (workflow name / job name); это стабильный идентификатор для branch protection.
- Документация: секция **Quality Gates** в `testing-strategy.md` фиксирует, что `pnpm check`
  немутирующий, required job = `check`, install из lockfile, запуск на PR.

## Technical Details

- Точная строка `check` в `package.json`: `"check": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm test"`.
- `.nvmrc` содержимое — ровно `24\n` (nvm/setup-node резолвит до последней 24.x).
- `engines`: добавить блок `"engines": { "node": ">=24" }`. Без `engine-strict` в `.npmrc`
  (его нет) pnpm лишь предупреждает; Node 26 условие удовлетворяет.
- `pnpm/action-setup@v4` без `version` — читает `packageManager: pnpm@10.0.0` автоматически.
- `actions/setup-node@v4` с `cache: pnpm` требует, чтобы pnpm уже был установлен (порядок steps соблюдён).
- `pnpm install --frozen-lockfile` — fails fast при рассинхроне `package.json` ↔ `pnpm-lock.yaml` (AC #4).
- prettier-гейт не покрывает `.json/.yml/.md` → правки `package.json`/workflow/доков формат-чекой не валидируются (это текущий контракт, не расширяем).

## What Goes Where

- **Implementation Steps** (`[ ]`): правки `package.json`, новый `.nvmrc`, новый workflow, правка `testing-strategy.md`, локальная верификация AC.
- **Post-Completion** (без чекбоксов): зелёный run GitHub Actions на PR (AC #7); опциональная настройка branch protection (required check `check / check`); опциональная проверка `actionlint`.

## Validation Commands

```bash
pnpm format:check                    # prettier --check — немутирующая проверка форматирования
pnpm typecheck                       # tsc --noEmit
pnpm lint                            # eslint .
pnpm test                            # vitest run (418 тестов)
pnpm check                           # format:check + typecheck + lint + test — итоговый немутирующий гейт

# Доказательство немутируемости (AC #6):
git status --porcelain               # пусто ДО `pnpm check`
pnpm check
git status --porcelain               # пусто И ПОСЛЕ `pnpm check`

# Опционально (если установлен) — статическая валидация workflow:
actionlint .github/workflows/*.yml
```

## Implementation Steps

### Task 1: `pnpm check` становится немутирующим

**Files:**

- Modify: `package.json` (scripts.check)

- [ ] заменить `scripts.check` на `"pnpm format:check && pnpm typecheck && pnpm lint && pnpm test"`
- [ ] убедиться, что `scripts.format` (prettier `--write`) **не изменён** — write-форматирование остаётся доступным (AC #2)
- [ ] validation: `pnpm format:check` зелёный; `pnpm check` выходит 0
- [ ] validation: `git status --porcelain` пуст до и после `pnpm check` (AC #1, #6)

### Task 2: Pin Node-версии (`.nvmrc` + `engines`)

**Files:**

- Create: `.nvmrc`
- Modify: `package.json` (добавить `engines.node`)

- [ ] создать `.nvmrc` с содержимым `24`
- [ ] добавить в `package.json` `"engines": { "node": ">=24" }` (рядом с `packageManager`)
- [ ] validation: локальный Node удовлетворяет `>=24` (текущий 26 — да); `pnpm install` без жёстких ошибок engine
- [ ] validation: `pnpm check` по-прежнему зелёный; `git status` чист

### Task 3: GitHub Actions workflow `check`

**Files:**

- Create: `.github/workflows/check.yml`

- [ ] создать workflow с `name: check`, trigger `on: pull_request` (без `push`)
- [ ] job `check` (`runs-on: ubuntu-latest`), steps: `actions/checkout@v4` → `pnpm/action-setup@v4` → `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm check`
- [ ] validation: YAML парсится; `actionlint .github/workflows/*.yml`, если установлен (иначе — ручная проверка отступов/ключей)
- [ ] зафиксировать в комментарии workflow: required job name = `check` (AC #5)

### Task 4: Документация контракта гейта

**Files:**

- Modify: `docs/engineering/testing-strategy.md` (секция **Quality Gates**)

- [ ] дополнить секцию **Quality Gates**: `pnpm check` — немутирующий (использует `format:check`), не пишет файлы
- [ ] зафиксировать: required CI job = `check`, ставится из lockfile (`--frozen-lockfile`), запускается на `pull_request`; write-форматирование остаётся через `pnpm format`
- [ ] validation: текст отражает текущую реализацию (AGENTS.md doc-sync); `pnpm check` зелёный (док на `.md` не форматируется гейтом)

### Task 5: Верификация AC и сбор evidence

**Files:**

- (без правок кода; только прогон проверок и, при закрытии задачи, перемещение плана)

- [ ] прогнать `pnpm check` — зелёный (AC #1, #4)
- [ ] подтвердить `git status --porcelain` пуст до и после `pnpm check` (AC #6) — записать как evidence
- [ ] сверить AC-чеклист: #1 check→format:check ✓; #2 `format` доступен ✓; #3 workflow on PR ✓; #4 frozen-lockfile + тот же `pnpm check` ✓; #5 job name `check` стабилен и задокументирован ✓; #6 немутирует ✓; #8 testing-strategy обновлён ✓
- [ ] после закрытия задачи (включая зелёный CI на PR — AC #7): переместить план в `docs/plans/completed/`

## Post-Completion

**Manual verification (внешние системы):**

- AC #7: открыть PR с этими изменениями и убедиться, что job `check` в GitHub Actions зелёный (зависимость #22 закрыта → baseline зелёный).
- Опционально: в GitHub branch protection добавить required status check `check / check` (AC #5 «required»).

**External system updates:**

- без consuming-проектов и deployment — нет.
