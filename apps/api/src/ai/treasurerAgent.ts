/**
 * The treasurer's question box.
 *
 * Someone types "how much came in for missions this month?" and gets an
 * answer plus a filtered grid. The agent never writes SQL: it fills in a
 * typed filter, the server runs it, and the same filter is handed back to the
 * UI so the numbers on screen and the numbers in the sentence come from one
 * query (docs/SPEC.md §5).
 */
import type Anthropic from '@anthropic-ai/sdk';

import { anthropic, models, logUsage } from './client.js';

export type LedgerFilter = {
  fundSlug?: 'GENERAL' | 'MISSIONS' | 'BENEVOLENCE' | 'BUILDING';
  direction?: 'IN' | 'OUT';
  /** ISO dates, inclusive. */
  from?: string;
  to?: string;
  minAmountCents?: number;
};

export type TreasurerAnswer = {
  filter: LedgerFilter;
  /** What the agent wants to say once it has seen the numbers. */
  answer: string;
};

const QUERY_LEDGER: Anthropic.Tool = {
  name: 'query_ledger',
  description:
    'Filter the church ledger. Use this to answer any question about money in or out. You cannot write SQL; these filters are the only way to read the data.',
  input_schema: {
    type: 'object',
    properties: {
      fund_slug: {
        type: 'string',
        enum: ['GENERAL', 'MISSIONS', 'BENEVOLENCE', 'BUILDING'],
        description: 'Restrict to one fund. Omit for all funds.',
      },
      direction: {
        type: 'string',
        enum: ['IN', 'OUT'],
        description: 'IN is money given, OUT is money distributed. Omit for both.',
      },
      from: { type: 'string', description: 'Earliest date, YYYY-MM-DD, inclusive.' },
      to: { type: 'string', description: 'Latest date, YYYY-MM-DD, inclusive.' },
      min_amount_dollars: { type: 'number', description: 'Only rows at or above this amount.' },
    },
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You answer a church treasurer's questions about their ledger.

You cannot write SQL and you cannot see the data until you ask for it. Call
query_ledger with a filter, read what comes back, then answer.

- Answer in the language the treasurer used.
- Be short and specific. One or two sentences with the actual number.
- The totals you are given are authoritative. Never estimate, never round in a
  way that changes the figure, and never invent a number you were not shown.
- If the filter returns nothing, say so plainly instead of guessing why.
- If the question is ambiguous about dates or funds, pick the most natural
  reading, answer, and say which reading you took.
- Amounts are in US dollars.`;

export type LedgerSummary = {
  rowCount: number;
  totalInCents: number;
  totalOutCents: number;
  firstDate: string | null;
  lastDate: string | null;
  byFund: { fund: string; totalCents: number }[];
};

/** The caller runs the query; this keeps the agent away from the database. */
export type RunQuery = (filter: LedgerFilter) => Promise<LedgerSummary>;

export async function answerTreasurerQuestion(options: {
  question: string;
  today: string;
  runQuery: RunQuery;
}): Promise<TreasurerAnswer> {
  const { question, today, runQuery } = options;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Today is ${today}.\n\nQuestion: ${question}` },
  ];

  let lastFilter: LedgerFilter = {};

  for (let turn = 0; turn < 3; turn++) {
    const reply = await anthropic.messages.create({
      model: models.main,
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [QUERY_LEDGER],
      messages,
    });
    logUsage('treasurer-agent', reply.usage);

    const uses = reply.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (uses.length === 0) {
      const text = reply.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return { filter: lastFilter, answer: text };
    }

    messages.push({ role: 'assistant', content: reply.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const raw = use.input as Record<string, unknown>;
      const filter: LedgerFilter = {
        fundSlug: raw.fund_slug as LedgerFilter['fundSlug'],
        direction: raw.direction as LedgerFilter['direction'],
        from: typeof raw.from === 'string' ? raw.from : undefined,
        to: typeof raw.to === 'string' ? raw.to : undefined,
        minAmountCents:
          typeof raw.min_amount_dollars === 'number'
            ? Math.round(raw.min_amount_dollars * 100)
            : undefined,
      };
      lastFilter = filter;

      const summary = await runQuery(filter);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({
          rows: summary.rowCount,
          total_in_dollars: (summary.totalInCents / 100).toFixed(2),
          total_out_dollars: (summary.totalOutCents / 100).toFixed(2),
          first_date: summary.firstDate,
          last_date: summary.lastDate,
          by_fund: summary.byFund.map((f) => ({
            fund: f.fund,
            total_dollars: (f.totalCents / 100).toFixed(2),
          })),
        }),
      });
    }

    messages.push({ role: 'user', content: results });
  }

  return { filter: lastFilter, answer: '' };
}
