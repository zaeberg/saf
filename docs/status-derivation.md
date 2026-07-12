# SAF status derivation

`saf status <issue>` восстанавливает workflow state из GitHub и Git без локальной постоянной базы данных. `.saf/runtime/` не является источником истины.

## Источники facts

- Issue и versioned marker comments;
- configured GitHub Project item и его `Status`;
- Git branches;
- Pull Request, на который ссылается run marker;
- checks текущего PR head SHA;

Команда выполняет только read-only GitHub REST/GraphQL requests и локальные Git reads.

## Precedence

Reducer применяет правила в следующем порядке:

1. Invalid, unknown или conflicting markers дают `Blocked`.
2. Merged Pull Request даёт `Done`.
3. Closed Issue без Pull Request даёт `Cancelled`.
4. Closed unmerged Pull Request, failed run, отсутствующая run branch, missing referenced PR или failed CI дают `Blocked`.
5. Open Pull Request даёт `Review`.
6. Active или успешно завершённый run без PR даёт recovery state `Running`.
7. Валидный approved plan даёт `Ready`.
8. Project Status `Shaping` без более сильного evidence даёт `Shaping`.
9. В остальных случаях результат — `Inbox`.

Project Status сравнивается с derived state после derivation. Он отображает workflow, но сам по себе не доказывает готовность. `Project Status = Done` без merged Pull Request является blocking drift.

## Marker envelope v1

Машинный envelope хранится одной HTML comment и содержит gzip-compressed, base64url-encoded JSON:

```text
<!-- saf:marker:v1:<base64url-json> -->
```

После скрытого envelope всегда публикуется видимая human-readable часть:

- `approved-plan`: Issue, revision, SHA-256 и полный plan внутри `<details>`;
- `run`: state, branch, run ID и Pull Request, если он уже известен;

Каноническое восстановление использует только payload envelope. Видимая часть является UX presentation и не участвует в state derivation или hash verification. Поэтому ручное форматирование comment не меняет evidence, а Markdown fences внутри plan не ломают parser.

MVP определяет kinds `approved-plan` и `run`. Неизвестная version не интерпретируется как валидное состояние. Идентичные duplicate markers допустимы, конфликтующие payload одного kind блокируют derivation.
