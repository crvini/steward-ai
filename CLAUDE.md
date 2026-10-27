# Steward AI — notes for Claude Code

**The full project spec lives in [`docs/SPEC.md`](docs/SPEC.md). Read it before writing code.**

Quick reminders:

- All code, comments, README and UI strings are written in **English**. The UI is
  translatable to Spanish through react-i18next (EN/ES).
- Never read, print, copy or modify the values in `.env`. Refer to variables by name only.
- Never commit secrets. `.env` is gitignored; `.env.example` holds names with no real values.
- Small, frequent commits with clear messages.
- The AI **proposes**; deterministic rule code **decides**. The agent never calls PayPal
  Payouts directly — only `/distributions/:id/execute` does, and only after two-key approval
  and a passing rules check.
- Every proposal, approval, rejection and execution is written to `AuditLog`.

## Layout

| Path | What it holds |
|---|---|
| `apps/api` | Express API, PayPal + AI services, webhooks, rules engine |
| `apps/web` | React + Vite donor chat and treasurer dashboard (AG Grid) |
| `packages/shared` | Types and Zod schemas shared by api and web |
| `prisma` | `schema.prisma`, migrations, seed |
| `docs` | `SPEC.md` (source of truth), `SUBMISSION.md` (Devpost checklist) |

## Commands

```bash
pnpm db:up        # start PostgreSQL in Docker
pnpm db:migrate   # apply Prisma migrations
pnpm db:seed      # load the Hope Church demo data
pnpm dev          # run api + web
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # Vitest
```
