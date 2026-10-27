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
import { distributionsRouter } from './routes/distributions.js';
import { ledgerRouter } from './routes/ledger.js';
import { impactRouter } from './routes/impact.js';
import { activityRouter } from './routes/activity.js';
import { pastorRouter } from './routes/pastor.js';
import { webhooksRouter } from './routes/webhooks.js';
import { reconcileRouter } from './routes/reconcile.js';
import { PayPalApiError } from './paypal/client.js';
import { attachSession } from './auth/session.js';

export function createServer(): Express {
  const app = express();

  // Las respuestas de la API son dinámicas y por sesión: un ETag solo invita
  // al navegador a revalidar y devolver 304.
  app.set('etag', false);

  app.use(cors({ origin: env.WEB_URL, credentials: true }));

  // Webhooks are mounted before the JSON parser: signature verification needs
  // PayPal's exact bytes, and express.json() would consume the stream.
  app.use('/api', webhooksRouter);

  app.use(express.json());
  app.use(attachSession);

  /**
   * Nothing this API returns should be cached by a browser.
   *
   * Two reasons. These are per-session financial records, and a cached copy
   * outliving the session is a leak. And Express adds an ETag to JSON by
   * default, so the browser sends If-None-Match and gets a 304 — which the
   * client read as a failed request, surfacing "Request failed: 304" on a
   * page that was working fine.
   */
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.get('/', (_req, res) => {
    res.json({ name: 'Steward AI API', version: '0.1.0' });
  });

  app.use(healthRouter);
  app.use('/api', paypalRouter);
  app.use('/api', giftsRouter);
  app.use('/api', subscriptionsRouter);
  app.use('/api', aiRouter);
  app.use('/api', distributionsRouter);
  app.use('/api', ledgerRouter);
  app.use('/api', impactRouter);
  app.use('/api', activityRouter);
  app.use('/api', pastorRouter);
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
