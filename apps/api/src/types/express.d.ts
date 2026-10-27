import type { SessionUser } from '../auth/types.js';

// Augmenting the global Express namespace is what works across @types/express
// v4 and v5; augmenting 'express-serve-static-core' directly does not resolve.
declare global {
  namespace Express {
    interface Request {
      /** The signed-in demo user, or null for an anonymous visitor. */
      user?: SessionUser | null;
    }
  }
}

export {};
