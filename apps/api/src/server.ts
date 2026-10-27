import express, { type Express } from 'express';
import cors from 'cors';

import { env } from './config/env.js';

export function createServer(): Express {
  const app = express();

  app.use(cors({ origin: env.WEB_URL, credentials: true }));
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({ name: 'Steward AI API', version: '0.1.0' });
  });

  return app;
}
