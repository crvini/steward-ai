/**
 * The only place the Anthropic SDK is imported (spec §5). Everything else in the
 * server talks to Claude through this module, so swapping models or adding
 * caching happens in one file.
 */
import Anthropic from '@anthropic-ai/sdk';

import { env } from '../config/env.js';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const models = {
  /** Giving intent, distribution proposals, treasurer questions. */
  main: env.ANTHROPIC_MODEL_MAIN,
  /** Impact updates, short translations. */
  fast: env.ANTHROPIC_MODEL_FAST,
} as const;

/**
 * Used by /health. `models.retrieve` is a plain GET: it proves the key is valid
 * and the configured model exists without spending a single token.
 */
export async function pingAnthropic(): Promise<{ main: string; fast: string }> {
  const [main, fast] = await Promise.all([
    anthropic.models.retrieve(models.main),
    anthropic.models.retrieve(models.fast),
  ]);
  return { main: main.id, fast: fast.id };
}

/** Logged per request so token spend stays visible without logging any content. */
export function logUsage(
  label: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null },
) {
  const cached = usage.cache_read_input_tokens ?? 0;
  console.log(
    `[ai] ${label} in=${usage.input_tokens} out=${usage.output_tokens} cached=${cached}`,
  );
}
