/**
 * POST /api/ai/giving — the donor chat, streamed over Server-Sent Events.
 *
 * Rate limited per signed-in user, falling back to IP: the demo is public and
 * the Anthropic key is real.
 */
import { Router } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { RateLimiter } from '../ai/rateLimit.js';
import { runGivingAgent, type ChatTurn } from '../ai/givingAgent.js';

export const aiRouter = Router();

const limiter = new RateLimiter(env.AI_RATE_LIMIT_PER_HOUR, 3_600_000);

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        // A cap here is a cost control, not a style choice.
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

aiRouter.post('/ai/giving', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_signed_in' });

  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
  }

  const key = req.user.id || req.ip || 'anon';
  const verdict = limiter.check(key);
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    return res.status(429).json({
      error: 'rate_limited',
      retryAfterSeconds: verdict.retryAfterSeconds,
      limitPerHour: env.AI_RATE_LIMIT_PER_HOUR,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx buffers proxied responses by default, which would hold the whole
  // stream until the end and defeat the point of streaming.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  // If the donor closes the tab mid-answer, stop paying for tokens.
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const history: ChatTurn[] = parsed.data.messages;

    for await (const event of runGivingAgent({
      churchId: req.user.churchId,
      donorName: req.user.name,
      history,
    })) {
      if (aborted) break;
      send(event);

      if (event.type === 'proposal') {
        await prisma.auditLog.create({
          data: {
            actor: req.user.email,
            action: 'ai.gift_proposed',
            entity: 'Fund',
            entityId: event.proposal.fundId,
            payload: {
              amountCents: event.proposal.amountCents,
              frequency: event.proposal.frequency,
              model: env.ANTHROPIC_MODEL_MAIN,
            },
          },
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ai] stream failed:', message);
    if (!aborted) send({ type: 'error', message });
  } finally {
    res.end();
  }
});
