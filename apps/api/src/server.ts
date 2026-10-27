import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { paypalRouter } from './routes/paypal.js';
import { giftsRouter } from './routes/gifts.js';
import { churchRouter } from './routes/church.js';
import { sessionRouter } from './routes/session.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { aiRouter } from './routes/ai.js';
import { webhooksRouter } from './routes/webhooks.js';
import { reconcileRouter } from './routes/reconcile.js';
import { PayPalApiError } from './paypal/client.js';
import { attachSession } from './auth/session.js';

export function createServer(): Express {
  const app = express();

  app.use(cors({ origin: env.WEB_URL, credentials: true }));

  // Webhooks are mounted before the JSON parser: signature verification needs
  // PayPal's exact bytes, and express.json() would consume the stream.
  app.use('/api', webhooksRouter);

  app.use(express.json());
  app.use(attachSession);

  app.get('/', (_req, res) => {
    res.json({ name: 'Steward AI API', version: '0.1.0' });
  });

  app.use(healthRouter);
  app.use('/api', paypalRouter);
  app.use('/api', giftsRouter);
  app.use('/api', subscriptionsRouter);
  app.use('/api', aiRouter);
  app.use('/api', sessionRouter);
  app.use('/api', churchRouter);
  app.use('/api', reconcileRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Errors reach the client as a class and a short message — never a provider
  // response body, which could echo request details back out.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof PayPalApiError) {
      console.error(`[api] ${error.name}: ${error.message}`);
      return res.status(502).json({ error: 'paypal_error', status: error.status });
    }
    console.error('[api] unhandled error:', error);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
