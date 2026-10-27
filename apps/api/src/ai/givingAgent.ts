/**
 * The giving agent: a donor says what they want to give, in English or
 * Spanish, and the agent turns it into a proposal.
 *
 * The hard rule of this file is that **the agent never moves money**. Its only
 * structured output is a proposal; the PayPal order or subscription is created
 * by the existing endpoints, after the person presses the button. There is no
 * code path from a model response to a charge (docs/SPEC.md §5).
 */
import type Anthropic from '@anthropic-ai/sdk';

import { anthropic, models, logUsage } from './client.js';
import { prisma } from '../db/client.js';

export type GiftProposal = {
  fundId: string;
  fundName: string;
  amountCents: number;
  frequency: 'ONE_TIME' | 'MONTHLY';
};

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'proposal'; proposal: GiftProposal }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * Stable on purpose: everything that varies by request lives in the messages,
 * so this prefix stays cacheable across every conversation.
 */
const SYSTEM_PROMPT = `You are the giving assistant for a church using Steward AI.

Your job is to understand what someone wants to give and turn it into a single
proposal. You never charge anything. You never claim a gift has been made. The
person always confirms on a card with a PayPal button after you propose.

How to behave:
- Reply in the language the person writes in. Spanish and English are both normal here.
- Be warm and brief — two or three sentences at most. This is a church, not a storefront.
- Never pressure anyone to give more, give again, or give at all. If someone is
  unsure or asks about their finances, say it is entirely their decision and stop.
- If you do not know which fund they mean, call list_funds and ask a short question.
  Do not guess between two funds.
- If the amount is missing, ask for it. Do not invent one.
- Monthly gifts are whole dollars only. If someone asks for a monthly gift with
  cents, say so plainly and offer the nearest whole dollar.
- When you have an amount, a fund and a frequency, call propose_gift exactly once.
  Say one short sentence alongside it; the card shows the details, so do not
  repeat them in a list.
- If someone asks for something you cannot do — changing a past gift, refunds,
  seeing someone else's giving — say so plainly and suggest they ask the treasurer.`;

const LIST_FUNDS: Anthropic.Tool = {
  name: 'list_funds',
  description:
    'List the funds this church accepts gifts for, with a short description of each. Call this when you need to match what the person said to a real fund.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

const PROPOSE_GIFT: Anthropic.Tool = {
  name: 'propose_gift',
  description:
    'Propose a gift for the person to confirm. This does NOT charge anything: it shows them a confirmation card with a PayPal button. Call it once you know the amount, the fund and whether it is one-time or monthly.',
  input_schema: {
    type: 'object',
    properties: {
      fund_id: { type: 'string', description: 'The id of the fund, from list_funds.' },
      amount_dollars: {
        type: 'number',
        description:
          'Amount in US dollars. Monthly gifts must be a whole number; one-time gifts may have cents.',
      },
      frequency: {
        type: 'string',
        enum: ['ONE_TIME', 'MONTHLY'],
        description: 'ONE_TIME for a single gift, MONTHLY for a recurring one.',
      },
    },
    required: ['fund_id', 'amount_dollars', 'frequency'],
    additionalProperties: false,
  },
};

type FundRow = { id: string; name: string; description: string | null };

async function fundsForChurch(churchId: string): Promise<FundRow[]> {
  return prisma.fund.findMany({
    where: { churchId },
    orderBy: { slug: 'asc' },
    select: { id: true, name: true, description: true },
  });
}

/**
 * Validates what the model asked for against real data. The model proposing
 * something impossible is expected; letting it through is not.
 */
function buildProposal(
  input: unknown,
  funds: FundRow[],
): { ok: true; proposal: GiftProposal } | { ok: false; reason: string } {
  const raw = input as { fund_id?: unknown; amount_dollars?: unknown; frequency?: unknown };

  const fund = funds.find((f) => f.id === raw.fund_id);
  if (!fund) return { ok: false, reason: 'That fund id does not exist. Call list_funds first.' };

  const amount = Number(raw.amount_dollars);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'The amount must be a positive number of dollars.' };
  }
  if (amount > 10_000) {
    return { ok: false, reason: 'Gifts over $10,000 are not accepted in this demo.' };
  }

  const frequency = raw.frequency === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME';
  if (frequency === 'MONTHLY' && !Number.isInteger(amount)) {
    return {
      ok: false,
      reason:
        'Monthly gifts are whole dollars only, because the billing plan charges per $1 unit. Offer the nearest whole dollar.',
    };
  }

  return {
    ok: true,
    proposal: {
      fundId: fund.id,
      fundName: fund.name,
      amountCents: Math.round(amount * 100),
      frequency,
    },
  };
}

const MAX_TURNS = 4;

/**
 * Streams the agent's reply. Yields text as it arrives and, at most once, a
 * proposal for the person to confirm.
 */
export async function* runGivingAgent(options: {
  churchId: string;
  donorName: string;
  history: ChatTurn[];
}): AsyncGenerator<AgentEvent> {
  const { churchId, donorName, history } = options;
  const funds = await fundsForChurch(churchId);

  const messages: Anthropic.MessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  try {
    // Once a proposal is made the agent gets one last turn with no tools, so
    // it says a sentence to the donor instead of the card appearing in
    // silence. Without this it often answers with the tool call alone.
    let closing = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = anthropic.messages.stream({
        model: models.main,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: `${SYSTEM_PROMPT}\n\nYou are speaking with ${donorName}.`,
            // The prefix is identical on every request, so it caches.
            cache_control: { type: 'ephemeral' },
          },
        ],
        ...(closing ? {} : { tools: [LIST_FUNDS, PROPOSE_GIFT] }),
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const reply = await stream.finalMessage();
      logUsage('giving-agent', reply.usage);

      const toolUses = reply.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: reply.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      let proposed: GiftProposal | null = null;

      for (const use of toolUses) {
        if (use.name === 'list_funds') {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(
              funds.map((f) => ({ id: f.id, name: f.name, description: f.description })),
            ),
          });
          continue;
        }

        if (use.name === 'propose_gift') {
          const built = buildProposal(use.input, funds);
          if (!built.ok) {
            // Hand the reason back so the agent can correct itself in words,
            // rather than failing silently in front of the donor.
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: built.reason,
              is_error: true,
            });
            continue;
          }
          proposed = built.proposal;
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content:
              'The confirmation card is now on screen. Do not repeat the details; just acknowledge briefly.',
          });
          continue;
        }

        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `Unknown tool ${use.name}`,
          is_error: true,
        });
      }

      messages.push({ role: 'user', content: results });

      if (proposed) {
        yield { type: 'proposal', proposal: proposed };
        closing = true;
      }
    }

    yield { type: 'done' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ai] giving agent failed:', message);
    yield { type: 'error', message };
  }
}
