/**
 * The rules engine.
 *
 * This is the part of Steward AI that decides. The AI proposes a distribution;
 * this code says yes or no to every line of it, and nothing reaches PayPal
 * that has not passed through here (docs/SPEC.md §5).
 *
 * Deliberately pure: no database, no network, no clock. Everything it needs
 * arrives as arguments, so every rule is testable and no rule can be skipped
 * by an unusual code path.
 */

export type RecipientFacts = {
  id: string;
  name: string;
  fundId: string;
  active: boolean;
  maxPerPayoutCents: number;
  paypalEmail: string;
};

export type ProposedLine = {
  recipientId: string;
  amountCents: number;
};

export type Limits = {
  /** MAX_PAYOUT_ITEM_USD, in cents. */
  maxPerItemCents: number;
  /** MAX_PAYOUT_BATCH_USD, in cents. */
  maxPerBatchCents: number;
};

/** Machine-readable so the UI can explain a block without parsing prose. */
export type RuleCode =
  | 'RECIPIENT_UNKNOWN'
  | 'RECIPIENT_INACTIVE'
  | 'RECIPIENT_WRONG_FUND'
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_NOT_WHOLE_CENTS'
  | 'OVER_RECIPIENT_LIMIT'
  | 'OVER_ITEM_LIMIT'
  | 'DUPLICATE_RECIPIENT';

export type BatchRuleCode = 'OVER_BATCH_LIMIT' | 'INSUFFICIENT_FUND_BALANCE' | 'NO_VALID_LINES';

export type CheckedLine = {
  recipientId: string;
  recipientName: string | null;
  paypalEmail: string | null;
  amountCents: number;
  ok: boolean;
  /** Why it was blocked. Empty when `ok`. */
  violations: { code: RuleCode; detail: string }[];
};

export type RulesVerdict = {
  lines: CheckedLine[];
  /** Problems with the batch as a whole, not with one line. */
  batchViolations: { code: BatchRuleCode; detail: string }[];
  /** Sum of the lines that passed. */
  payableCents: number;
  /** True only when every line passes and the batch passes. */
  executable: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Checks a proposed distribution against the recipients, the fund balance and
 * the configured limits.
 *
 * A line that fails is kept in the result, marked, with the reason. The
 * treasurer has to see what the AI tried to do and why it was refused —
 * silently dropping bad lines would hide exactly what needs reviewing.
 */
export function checkDistribution(options: {
  fundId: string;
  fundBalanceCents: number;
  recipients: RecipientFacts[];
  lines: ProposedLine[];
  limits: Limits;
}): RulesVerdict {
  const { fundId, fundBalanceCents, recipients, lines, limits } = options;

  const byId = new Map(recipients.map((r) => [r.id, r]));
  const seen = new Set<string>();

  const checked: CheckedLine[] = lines.map((line) => {
    const violations: { code: RuleCode; detail: string }[] = [];
    const recipient = byId.get(line.recipientId);

    if (!recipient) {
      violations.push({
        code: 'RECIPIENT_UNKNOWN',
        detail: 'This recipient is not on the approved list.',
      });
    } else {
      if (!recipient.active) {
        violations.push({
          code: 'RECIPIENT_INACTIVE',
          detail: `${recipient.name} is not currently active.`,
        });
      }
      if (recipient.fundId !== fundId) {
        violations.push({
          code: 'RECIPIENT_WRONG_FUND',
          detail: `${recipient.name} does not receive from this fund.`,
        });
      }
      if (line.amountCents > recipient.maxPerPayoutCents) {
        violations.push({
          code: 'OVER_RECIPIENT_LIMIT',
          detail: `${money(line.amountCents)} is over the ${money(
            recipient.maxPerPayoutCents,
          )} limit set for ${recipient.name}.`,
        });
      }
    }

    if (!Number.isInteger(line.amountCents)) {
      violations.push({
        code: 'AMOUNT_NOT_WHOLE_CENTS',
        detail: 'Amounts must be a whole number of cents.',
      });
    }
    if (line.amountCents <= 0) {
      violations.push({ code: 'AMOUNT_NOT_POSITIVE', detail: 'The amount must be positive.' });
    }
    if (line.amountCents > limits.maxPerItemCents) {
      violations.push({
        code: 'OVER_ITEM_LIMIT',
        detail: `${money(line.amountCents)} is over the ${money(
          limits.maxPerItemCents,
        )} limit for a single payout.`,
      });
    }

    // Two lines to the same recipient would silently double their payment.
    if (seen.has(line.recipientId)) {
      violations.push({
        code: 'DUPLICATE_RECIPIENT',
        detail: 'This recipient already appears in this distribution.',
      });
    }
    seen.add(line.recipientId);

    return {
      recipientId: line.recipientId,
      recipientName: recipient?.name ?? null,
      paypalEmail: recipient?.paypalEmail ?? null,
      amountCents: line.amountCents,
      ok: violations.length === 0,
      violations,
    };
  });

  const payableCents = checked
    .filter((l) => l.ok)
    .reduce((sum, l) => sum + l.amountCents, 0);

  const batchViolations: { code: BatchRuleCode; detail: string }[] = [];

  if (checked.length === 0 || checked.every((l) => !l.ok)) {
    batchViolations.push({
      code: 'NO_VALID_LINES',
      detail: 'There is nothing in this distribution that can be paid.',
    });
  }
  if (payableCents > limits.maxPerBatchCents) {
    batchViolations.push({
      code: 'OVER_BATCH_LIMIT',
      detail: `${money(payableCents)} is over the ${money(
        limits.maxPerBatchCents,
      )} limit for one distribution.`,
    });
  }
  if (payableCents > fundBalanceCents) {
    batchViolations.push({
      code: 'INSUFFICIENT_FUND_BALANCE',
      detail: `This fund holds ${money(fundBalanceCents)}, which is less than the ${money(
        payableCents,
      )} proposed.`,
    });
  }

  return {
    lines: checked,
    batchViolations,
    payableCents,
    // Every line must pass. A distribution that is "mostly fine" is not
    // something to execute: the treasurer removes the bad line first.
    executable: checked.length > 0 && checked.every((l) => l.ok) && batchViolations.length === 0,
  };
}
