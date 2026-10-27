# Devpost submission checklist

> Source: `docs/SPEC.md` §11. Fill in as the project is built.

- [x] Public repo with MIT LICENSE, complete README and green CI
- [x] Hosted demo working with test data — https://steward.e-ministry.online
- [ ] Public YouTube video, under 3 minutes
- [ ] 4–6 screenshots at 3:2
- [ ] "Built with" updated to what was actually used (include `anthropic` and `claude`)
- [ ] Spend limit configured on the Anthropic key for the public demo
- [ ] Technical requirement (PayPal + AI) explained in the form
- [ ] Instructions and test credentials for the judges
- [ ] Sponsor tools checked (AG Grid, Render)
- [ ] "Challenges", "Accomplishments" and "What we learned" written from what actually happened
- [ ] Submit before November 12, 2:00 PM (Guatemala time)

## Draft texts

### Elevator pitch

Steward AI is a generosity assistant for churches. Money comes in through
PayPal, gets distributed with two-key human approval, and every donor sees
what their gift accomplished. The AI proposes; deterministic code decides;
two people sign.

### Inspiration

_TBD_

### What it does

A member says what they want to give, in English or Spanish, and the
assistant turns it into a proposal they confirm with PayPal — one-time or
monthly. The treasurer asks the AI to plan a distribution; a rules engine
checks every line against the approved-recipient list, per-recipient and
global payout limits and the fund balance, and shows the treasurer every rule
it checked, not only the ones that failed. The treasurer signs, the pastor
signs, and only then does PayPal Payouts send the money. Afterwards the AI
drafts a note for each donor about what their giving did, which a person
approves before it is sent.

### How we built it

React + Vite + AG Grid on the front, Express + Prisma + PostgreSQL behind it,
in a pnpm monorepo. PayPal through plain REST: JS SDK v6, Orders v2,
Subscriptions, Payouts, Webhooks with signature verification, and Transaction
Search for reconciliation. Claude through the official SDK with tool use —
Sonnet for the giving, distribution and ledger agents, Haiku for impact notes
and the pastor's weekly brief. Deployed on the same DigitalOcean droplet that
runs e-Ministry, with the frontend built locally because that box has one
core and a Vite build starves nginx.

### Challenges we ran into

_TBD_

### Accomplishments that we're proud of

_TBD_

### What we learned

_TBD_

### What's next for Steward AI

_TBD_
