import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the process. `tsx watch` re-evaluates modules on every
 * save, so the instance is parked on globalThis to avoid leaking connections
 * during development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
