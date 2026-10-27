import { Router } from 'express';

import { browserSafeClientToken } from '../paypal/client.js';
import { env } from '../config/env.js';

export const paypalRouter = Router();

/**
 * The JS SDK v6 needs a browser-safe client token. It is domain-bound and
 * expires in minutes; the client secret never leaves the server.
 */
paypalRouter.get('/paypal/client-token', async (_req, res, next) => {
  try {
    const { token, expiresIn } = await browserSafeClientToken();
    res.json({ clientToken: token, expiresIn, environment: env.PAYPAL_ENV });
  } catch (error) {
    next(error);
  }
});
