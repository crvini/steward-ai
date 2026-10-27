import type { UserRole } from '@prisma/client';

/** The signed-in demo user, as every route sees it on `req.user`. */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  locale: string;
  churchId: string;
};
