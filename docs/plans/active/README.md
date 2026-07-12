# SAF MVP Implementation Plans

Эта директория содержит последовательные планы реализации [SAF MVP](../../saf-mvp.md). Планы исполняются по одному; следующий срез начинается после проверки и приёмки предыдущего.

## Порядок

| План | Результат | Зависит от |
|---|---|---|
| [SAF-001](../done/saf-001-cli-foundation.md) | Исполняемый CLI и базовые контракты | — |
| [SAF-002](../done/saf-002-init.md) | Repository привязан к одному GitHub Project | SAF-001 |
| [SAF-002A](./saf-002a-github-transport.md) | Единый Octokit transport и GitHub adapter | SAF-002 |
| [SAF-003](./saf-003-status.md) | Stateless state derivation и `saf status` | SAF-002A |
| [SAF-004](./saf-004-shape.md) | Issue превращается в approved plan | SAF-003 |
| [SAF-005](./saf-005-build.md) | Approved plan превращается в Draft PR | SAF-004 |
| [SAF-006](./saf-006-review.md) | Текущий PR SHA получает human acceptance | SAF-005 |
| [SAF-007](./saf-007-recovery-and-pilot.md) | Проверены recovery, idempotency и MVP целиком | SAF-006 |

## Общие правила исполнения

- Не объединять соседние планы в один большой change.
- Не начинать следующий план при незакрытых blocking findings текущего.
- Каждый срез должен оставлять CLI в рабочем и тестируемом состоянии.
- GitHub live smoke tests не входят в обычный автоматический test suite.
- Новые внешние зависимости требуют обоснования в Pull Request.
- Изменение зафиксированного контракта обновляет MVP-документ и затронутые последующие планы.
- Реализация не должна добавлять cross-repository discovery или глобальный каталог Projects.
