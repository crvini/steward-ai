import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import dotenv from 'dotenv';

// The workspace keeps a single .env at the repo root, four levels up from both
// src/config/ and the built dist/config/. Loaded explicitly so the API behaves
// the same whatever directory it is started from.
dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

/**
 * Environment is validated once at boot. Never log the parsed values — only
 * variable names are safe to print.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_WEBHOOK_ID: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_MAIN: z.string().default('claude-sonnet-5-5'),
  ANTHROPIC_MODEL_FAST: z.string().default('claude-haiku-5-5'),

  DATABASE_URL: z.string().min(1),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(1),

  /** AI requests allowed per signed-in user (or IP) per hour on the demo. */
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),

  MAX_PAYOUT_ITEM_USD: z.coerce.number().positive().default(500),
  MAX_PAYOUT_BATCH_USD: z.coerce.number().positive().default(2000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print only the names of the offending variables, never their values.
  const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
  console.error(`[env] Missing or invalid environment variables: ${names.join(', ')}`);
  console.error('[env] See .env.example for the full list.');
  process.exit(1);
}

export const env = parsed.data;
