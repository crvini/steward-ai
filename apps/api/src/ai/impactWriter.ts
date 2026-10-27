/**
 * The impact writer.
 *
 * After a distribution is paid, every donor who gave to that fund gets a short
 * note about what their giving did. Written by Haiku because the task is
 * small and repeated once per donor — using the big model here would be
 * paying for reasoning the task does not need.
 *
 * The notes are drafts. A human approves each one before a donor sees it.
 */
import { anthropic, models, logUsage } from './client.js';

export type ImpactFacts = {
  donorName: string;
  donorLocale: string;
  fundName: string;
  /** What this donor gave to the fund in the period, in cents. */
  donorGaveCents: number;
  /** What the church distributed, in cents. */
  distributedCents: number;
  recipients: { name: string; amountCents: number }[];
};

const SYSTEM_PROMPT = `You write one short note to a church donor about what the money they gave was used for.

Rules:
- Write in the donor's language. "es" means Spanish, "en" means English.
- Three sentences at most. Warm, plain, specific. A real person wrote this.
- Name what the money actually did, using the recipients and amounts given.
- Never promise results you were not told about. Never claim a number of
  people helped, souls saved, meals served or anything else invented. If you
  were not given a detail, leave it out.
- Do not ask for another gift. Do not say "consider giving again". This note
  exists to close the loop, not to open a new one.
- Do not use the words "impact", "blessing" or "generosity" more than once.
- No greeting line and no signature; the app adds those.`;

export async function draftImpactNote(facts: ImpactFacts): Promise<string> {
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

  const brief = [
    `Donor: ${facts.donorName}`,
    `Donor language: ${facts.donorLocale}`,
    `Fund: ${facts.fundName}`,
    `What this donor gave to that fund: ${dollars(facts.donorGaveCents)}`,
    `What the church just distributed from it: ${dollars(facts.distributedCents)}`,
    'Where it went:',
    ...facts.recipients.map((r) => `- ${r.name}: ${dollars(r.amountCents)}`),
  ].join('\n');

  const reply = await anthropic.messages.create({
    model: models.fast,
    // Generous for a three-sentence note on purpose: these models think
    // before they answer, and a tight cap spent the whole budget on
    // reasoning and returned a truncated sentence ("Grac").
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: brief }],
  });

  logUsage('impact-writer', reply.usage);

  const text = reply.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim();

  // A truncated note must not reach a donor looking like a finished sentence.
  if (reply.stop_reason === 'max_tokens' || text.length < 20) {
    throw new Error(
      `Impact note came back unusable (stop_reason=${reply.stop_reason}, ${text.length} chars)`,
    );
  }

  return text;
}
