/**
 * Webhook signature verification (spec §4).
 *
 * PayPal signs each notification. We re-post the transmission headers plus the
 * event body to `verify-webhook-signature` and only act on a `SUCCESS` verdict.
 *
 * The event body must be byte-identical to what PayPal sent: re-serializing a
 * parsed object can reorder keys or change number formatting and fail
 * verification. So the raw request body is spliced into the verification
 * payload as a literal, never round-tripped through JSON.stringify.
 */
import { paypal } from './client.js';
import { env } from '../config/env.js';

export type TransmissionHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export type VerificationResult =
  | { verified: true }
  | { verified: false; reason: string };

/** Pulls the five headers PayPal signs with. Header names are case-insensitive. */
export function readTransmissionHeaders(
  headers: Record<string, string | string[] | undefined>,
): TransmissionHeaders | null {
  const get = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const authAlgo = get('paypal-auth-algo');
  const certUrl = get('paypal-cert-url');
  const transmissionId = get('paypal-transmission-id');
  const transmissionSig = get('paypal-transmission-sig');
  const transmissionTime = get('paypal-transmission-time');

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return null;
  }
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/**
 * PayPal only ever serves certificates from its own domains. Checking this
 * before handing `cert_url` to the verifier stops a forged header from
 * pointing the lookup somewhere else.
 */
export function isTrustedCertUrl(certUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(certUrl);
    if (protocol !== 'https:') return false;
    return hostname === 'api.paypal.com' || hostname.endsWith('.paypal.com');
  } catch {
    return false;
  }
}

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

  // Built as a string so `webhook_event` keeps PayPal's exact bytes.
  const body =
    '{' +
    `"auth_algo":${JSON.stringify(headers.authAlgo)},` +
    `"cert_url":${JSON.stringify(headers.certUrl)},` +
    `"transmission_id":${JSON.stringify(headers.transmissionId)},` +
    `"transmission_sig":${JSON.stringify(headers.transmissionSig)},` +
    `"transmission_time":${JSON.stringify(headers.transmissionTime)},` +
    `"webhook_id":${JSON.stringify(env.PAYPAL_WEBHOOK_ID)},` +
    `"webhook_event":${rawBody}` +
    '}';

  const result = await paypal.postRaw<{ verification_status: 'SUCCESS' | 'FAILURE' }>(
    '/v1/notifications/verify-webhook-signature',
    body,
  );

  return result.verification_status === 'SUCCESS'
    ? { verified: true }
    : { verified: false, reason: `verification_status=${result.verification_status}` };
}
