/**
 * Webhook signature verification (spec §4).
 *
 * PayPal signs each notification. We re-post the transmission headers plus the
 * event body to `verify-webhook-signature` and only act on a `SUCCESS` verdict.
 * The pure parts live in `signature.ts`; this module adds credentials and the
 * network call.
 */
import { paypal } from './client.js';
import { env } from '../config/env.js';
import {
  buildVerificationPayload,
  isTrustedCertUrl,
  type TransmissionHeaders,
} from './signature.js';

export { readTransmissionHeaders, isTrustedCertUrl } from './signature.js';
export type { TransmissionHeaders } from './signature.js';

export type VerificationResult = { verified: true } | { verified: false; reason: string };

export async function verifyWebhookSignature(
  headers: TransmissionHeaders,
  rawBody: string,
): Promise<VerificationResult> {
  if (!env.PAYPAL_WEBHOOK_ID) {
    return { verified: false, reason: 'PAYPAL_WEBHOOK_ID is not configured' };
  }
  if (!isTrustedCertUrl(headers.certUrl)) {
    return { verified: false, reason: 'cert_url is not a PayPal host' };
  }

  const body = buildVerificationPayload(headers, env.PAYPAL_WEBHOOK_ID, rawBody);

  const result = await paypal.postRaw<{ verification_status: 'SUCCESS' | 'FAILURE' }>(
    '/v1/notifications/verify-webhook-signature',
    body,
  );

  return result.verification_status === 'SUCCESS'
    ? { verified: true }
    : { verified: false, reason: `verification_status=${result.verification_status}` };
}
