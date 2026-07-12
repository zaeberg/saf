# Example SAF plan

## Goal

Deliver one focused and verifiable workflow improvement without expanding the approved scope.

## Tasks

- Implement the required behavior behind the existing repository adapters.
- Add deterministic coverage for success, failure, idempotency and recovery.
- Update user-facing documentation affected by the behavior.

## Acceptance criteria

- The command produces the documented observable result.
- Failed validation does not publish a successful workflow transition.
- Repeating the command does not create duplicate canonical artifacts.

## Validation

```bash
pnpm check
pnpm build
```
