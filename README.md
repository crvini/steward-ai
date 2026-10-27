# Steward AI

**Generosity with transparency — from the moment someone gives to the moment they see the fruit.**

Steward AI is an AI generosity assistant for churches. Money comes in through PayPal,
gets distributed with human two-key approval, and every donor sees what their gift
accomplished. Built for the PayPal AI Hackathon 2026.

Small and mid-sized churches — especially in Latin America — run tithes, offerings and
designated funds on cash, loose transfers and spreadsheets. The treasurer loses hours
reconciling, money for missions or benevolence takes weeks to move, and donors almost
never learn what their gift did. Steward AI closes that loop.

## What makes it different

- **Designated fund accounting.** Every dollar knows which fund it belongs to, from
  intake to payout.
- **Two-key approval.** No distribution leaves without both the treasurer's and the
  pastor's signature.
- **Deterministic rules before PayPal.** The AI only *proposes*. Code validates amount
  limits, allowed recipients and fund balance. The AI can never approve or skip a rule.
- **Impact loop.** Donors get a personal report of what their gift accomplished, based
  on what was actually distributed.
- **Bilingual (EN/ES)** from day one.

## Getting started

> Work in progress — this section is completed as the project is built.

**Requirements:** Node 22+, pnpm 9+, Docker (for PostgreSQL).

```bash
# 1. Clone
git clone https://github.com/<user>/steward-ai.git
cd steward-ai

# 2. Configure environment
cp .env.example .env     # then fill in your PayPal sandbox and Anthropic keys

# 3. Install, start the database, migrate, seed and run
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API runs on <http://localhost:4000> and the web app on <http://localhost:5173>.

## How we use PayPal

> To be completed — see [`docs/SPEC.md`](docs/SPEC.md) §4.

## How we use AI

> To be completed — see [`docs/SPEC.md`](docs/SPEC.md) §5.

## License

[MIT](LICENSE) © E-Ministry / Vinicio Cruz
