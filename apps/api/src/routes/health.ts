/**
 * GET /health — proves the three live dependencies actually answer.
 *
 * Never returns a key, a token, or any part of one. Failures surface the error
 * class and message only, which is enough to debug a bad credential without
 * printing it.
 */
import { Router } from 'express';

import { prisma } from '../db/client.js';
import { pingPayPal } from '../paypal/client.js';
import { pingAnthropic } from '../ai/client.js';

type Check = { ok: boolean; detail: string };

async function check(run: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Truncate: a provider error body should never become a log dump.
    return { ok: false, detail: message.slice(0, 200) };
  }
}

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const [database, paypal, anthropic] = await Promise.all([
    check(async () => {
      const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
      const version = rows[0]?.version ?? 'unknown';
      const funds = await prisma.fund.count();
      return `${version.split(',')[0]}, ${funds} funds seeded`;
    }),
    check(async () => {
      const { environment } = await pingPayPal();
      return `OAuth token issued (${environment})`;
    }),
    check(async () => {
      const { main, fast } = await pingAnthropic();
      return `models reachable: ${main}, ${fast}`;
    }),
  ]);

  const services = { database, paypal, anthropic };
  const ok = Object.values(services).every((s) => s.ok);

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checkedAt: new Date().toISOString(),
    services,
  });
});
