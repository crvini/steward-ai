/**
 * Demo sessions: the judges pick a role and are in. No passwords, no sign-up.
 *
 * Only users that already exist in the seeded church can be chosen, so this is
 * a role picker over fixed demo data — not an authentication system, and it is
 * not pretending to be one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';
import { clearSessionCookie, setSessionCookie } from '../auth/session.js';

export const sessionRouter = Router();

/**
 * The three personas the entry screen offers, in order. Pinned by email so the
 * screen always shows the same people — picking "the first donor by name"
 * would quietly change whenever the seed data changes.
 */
const PERSONAS: { role: UserRole; email: string }[] = [
  { role: UserRole.DONOR, email: 'member@hopechurch.example' },
  { role: UserRole.TREASURER, email: 'treasurer@hopechurch.example' },
  { role: UserRole.PASTOR, email: 'pastor@hopechurch.example' },
];

sessionRouter.get('/session/roles', async (_req, res, next) => {
  try {
    const church = await prisma.church.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!church) return res.status(404).json({ error: 'no_church_seeded' });

    const users = await prisma.user.findMany({
      where: { churchId: church.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true, locale: true },
    });

    // The entry screen offers one person per role; the rest stay available in
    // the switcher so a judge can look at the data as different donors.
    const featured = PERSONAS.map(
      ({ role, email }) =>
        users.find((u) => u.email === email) ?? users.find((u) => u.role === role),
    ).filter((u): u is NonNullable<typeof u> => Boolean(u));

    res.json({ church: { id: church.id, name: church.name }, featured, users });
  } catch (error) {
    next(error);
  }
});

sessionRouter.get('/session', (req, res) => {
  res.json({ user: req.user ?? null });
});

const signInSchema = z.object({ userId: z.string().min(1) });

sessionRouter.post('/session', async (req, res, next) => {
  try {
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, name: true, email: true, role: true, locale: true, churchId: true },
    });
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    setSessionCookie(res, user.id);
    await prisma.auditLog.create({
      data: {
        actor: user.email,
        action: 'session.signed_in',
        entity: 'User',
        entityId: user.id,
        payload: { role: user.role },
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

sessionRouter.delete('/session', (_req, res) => {
  clearSessionCookie(res);
  res.json({ user: null });
});
