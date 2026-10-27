/**
 * The pastor's weekly brief.
 *
 * A pastor should not have to read a dashboard to know how the week went.
 * Haiku turns the week's actual numbers into a paragraph — and the screen
 * says, under it, that nothing in it moves money, because a brief that
 * summarises decisions must not look like one that makes them.
 */
import { anthropic, models, logUsage } from './client.js';

export type WeekFacts = {
  churchName: string;
  weekLabel: string;
  receivedCents: number;
  giftCount: number;
  newGivers: number;
  monthlyStarted: number;
  topFund: { name: string; cents: number } | null;
  awaitingPastor: { fund: string; totalCents: number }[];
  unconfirmed: { count: number; cents: number };
  locale: string;
};

const SYSTEM_PROMPT = `You write one short weekly brief for the pastor of a church, from that week's giving records.

Rules:
- Write in the pastor's language. "es" means Spanish, "en" means English.
- In Spanish use church vocabulary: "ofrenda" or "donación", never "regalo",
  which means a birthday present and reads as a translation mistake.
- Four or five sentences. Plain and calm, the way a trusted treasurer would
  brief someone in a hallway. Not a report, not marketing.
- Use only the numbers you are given. Never estimate, never invent a cause
  for a change, and never attribute giving to an event unless you were told
  about one.
- If something is waiting for the pastor's approval, say so and name the
  amount, because that is the one thing they must act on.
- If a gift has not been confirmed by PayPal, mention it plainly — that is
  the kind of thing a pastor should hear from their books, not discover later.
- Do not thank the pastor, do not open with a greeting, and do not close with
  encouragement. Start with what happened.`;

export async function writeWeeklyBrief(facts: WeekFacts): Promise<string> {
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

  const brief = [
    `Church: ${facts.churchName}`,
    `Language: ${facts.locale}`,
    `Week: ${facts.weekLabel}`,
    `Received this week: ${dollars(facts.receivedCents)} across ${facts.giftCount} gifts`,
    `People who gave for the first time: ${facts.newGivers}`,
    `Monthly gifts that started this week: ${facts.monthlyStarted}`,
    facts.topFund
      ? `Most of it went to ${facts.topFund.name} (${dollars(facts.topFund.cents)})`
      : 'No single fund stood out.',
    facts.awaitingPastor.length
      ? `Waiting for the pastor's approval: ${facts.awaitingPastor
          .map((d) => `${d.fund} for ${dollars(d.totalCents)} (the payable amount, after blocked lines)`)
          .join('; ')}`
      : 'Nothing is waiting for the pastor right now.',
    facts.unconfirmed.count
      ? `${facts.unconfirmed.count} gift(s) totalling ${dollars(facts.unconfirmed.cents)} are recorded in the books but not confirmed by PayPal.`
      : 'Every gift in the books is confirmed by PayPal.',
  ].join('\n');

  const reply = await anthropic.messages.create({
    model: models.fast,
    // Room to think before writing: a tight cap spends the budget on
    // reasoning and returns half a sentence.
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: brief }],
  });

  logUsage('weekly-brief', reply.usage);

  const text = reply.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim();

  if (reply.stop_reason === 'max_tokens' || text.length < 40) {
    throw new Error(`Weekly brief came back unusable (${text.length} chars)`);
  }
  return text;
}
