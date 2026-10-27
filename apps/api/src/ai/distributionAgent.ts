/**
 * The distribution agent.
 *
 * It reads fund balances, the approved recipients and what was sent last
 * time, and proposes how to split a fund. It cannot pay anyone: its output is
 * a list of lines and a short rationale, and every line then goes through the
 * rules engine before a human ever sees an approve button.
 *
 * This module must never import the payouts client. The only path to PayPal
 * is the execute endpoint, behind two approvals.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { anthropic, models, logUsage } from './client.js';

export type RecipientBrief = {
  id: string;
  name: string;
  maxPerPayoutCents: number;
  note: string | null;
  lastPaidCents: number | null;
  lastPaidAt: string | null;
};

export type ProposedPlan = {
  lines: { recipientId: string; amountCents: number }[];
  rationale: string;
};

const PROPOSE_DISTRIBUTION: Anthropic.Tool = {
  name: 'propose_distribution',
  description:
    'Propose how to split this fund among its approved recipients. This does NOT pay anyone: a rules engine checks every line and two people must approve before anything is sent.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'One line per recipient you want to pay. Omit recipients you would skip.',
        items: {
          type: 'object',
          properties: {
            recipient_id: { type: 'string' },
            amount_dollars: { type: 'number', description: 'US dollars, at most two decimals.' },
          },
          required: ['recipient_id', 'amount_dollars'],
          additionalProperties: false,
        },
      },
      rationale: {
        type: 'string',
        description:
          'Two or three sentences for the treasurer: why these amounts, and anything they should look at before approving.',
      },
    },
    required: ['lines', 'rationale'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You help a church treasurer distribute a designated fund to its approved recipients.

You propose. You never pay. Every line you write is checked by a rules engine
and then approved by both the treasurer and the pastor before any money moves.

How to propose:
- Leave a reasonable reserve. Emptying a fund to the last cent is not prudent,
  and benevolence funds especially need something left for an emergency.
- Respect each recipient's per-payout limit. Going over it is not a judgement
  call you get to make; the rules engine will block it and the treasurer will
  have to fix your work.
- Keep support steady. If someone received a given amount last month and the
  fund can afford it, propose the same. Churches support people, not projects,
  and a missionary budgeting on a fluctuating amount is a real problem.
- Round to whole dollars unless there is a reason not to.
- In the rationale, say plainly what you did and flag anything the treasurer
  should look at. If you are unsure about something, say so rather than
  sounding confident.
- If the fund is too small to be worth distributing, propose no lines and say
  why in the rationale.

Always answer by calling propose_distribution. Do not reply in prose.`;

export async function proposeDistribution(options: {
  fundName: string;
  fundBalanceCents: number;
  recipients: RecipientBrief[];
  limits: { maxPerItemCents: number; maxPerBatchCents: number };
  /** Set when a previous proposal was rejected by the rules engine. */
  correction?: string;
}): Promise<ProposedPlan> {
  const { fundName, fundBalanceCents, recipients, limits, correction } = options;

  const dollars = (c: number) => (c / 100).toFixed(2);

  const brief = [
    `Fund: ${fundName}`,
    `Balance available: $${dollars(fundBalanceCents)}`,
    `Maximum per single payout: $${dollars(limits.maxPerItemCents)}`,
    `Maximum for the whole distribution: $${dollars(limits.maxPerBatchCents)}`,
    '',
    'Approved recipients:',
    ...recipients.map((r) =>
      [
        `- id: ${r.id}`,
        `  name: ${r.name}`,
        `  limit per payout: $${dollars(r.maxPerPayoutCents)}`,
        r.note ? `  note: ${r.note}` : null,
        r.lastPaidCents !== null
          ? `  last received: $${dollars(r.lastPaidCents)} on ${r.lastPaidAt ?? 'an earlier date'}`
          : '  last received: nothing yet',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    correction
      ? `Your previous proposal was refused by the rules engine:\n${correction}\nPropose a corrected distribution.`
      : 'Propose a distribution.',
  ].join('\n');

  const request = {
    model: models.main,
    max_tokens: 1500,
    system: [
      { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
    ],
    tools: [PROPOSE_DISTRIBUTION],
  };

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: brief }];

  // `tool_choice` cannot force a tool on this model, so the shape is secured
  // by asking and then checking: if the model answers in prose, it gets one
  // nudge before we give up.
  let use: Anthropic.ToolUseBlock | undefined;

  for (let attempt = 0; attempt < 2 && !use; attempt++) {
    const reply = await anthropic.messages.create({ ...request, messages });
    logUsage('distribution-agent', reply.usage);

    use = reply.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === 'propose_distribution',
    );

    if (!use) {
      messages.push({ role: 'assistant', content: reply.content });
      messages.push({
        role: 'user',
        content: 'Answer by calling propose_distribution, not in prose.',
      });
    }
  }

  if (!use) throw new Error('The agent did not produce a distribution');

  const input = use.input as {
    lines?: { recipient_id?: string; amount_dollars?: number }[];
    rationale?: string;
  };

  return {
    lines: (input.lines ?? [])
      .filter((l) => typeof l.recipient_id === 'string' && Number.isFinite(l.amount_dollars))
      .map((l) => ({
        recipientId: l.recipient_id as string,
        // Rounding here keeps fractional cents out of the rules engine, which
        // would otherwise reject the agent's work on a technicality.
        amountCents: Math.round((l.amount_dollars as number) * 100),
      })),
    rationale: input.rationale ?? '',
  };
}
