import { z } from 'zod';

/** The four designated funds a church tracks money against. */
export const fundSlugSchema = z.enum(['general', 'missions', 'benevolence', 'building']);
export type FundSlug = z.infer<typeof fundSlugSchema>;

export const userRoleSchema = z.enum(['DONOR', 'TREASURER', 'PASTOR']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const giftFrequencySchema = z.enum(['ONE_TIME', 'MONTHLY']);
export type GiftFrequency = z.infer<typeof giftFrequencySchema>;

export const giftStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type GiftStatus = z.infer<typeof giftStatusSchema>;

export const transactionDirectionSchema = z.enum(['IN', 'OUT']);
export type TransactionDirection = z.infer<typeof transactionDirectionSchema>;

/** USD amount, at most two decimals, strictly positive. */
export const usdAmountSchema = z
  .number()
  .positive()
  .finite()
  .refine((n) => Number.isInteger(Math.round(n * 100)) && Math.round(n * 100) / 100 === n, {
    message: 'Amount must have at most two decimal places',
  });

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checkedAt: z.string(),
  services: z.object({
    database: z.object({ ok: z.boolean(), detail: z.string() }),
    paypal: z.object({ ok: z.boolean(), detail: z.string() }),
    anthropic: z.object({ ok: z.boolean(), detail: z.string() }),
  }),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;
