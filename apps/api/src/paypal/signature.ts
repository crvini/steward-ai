/**
 * Pure helpers for PayPal webhook signatures.
 *
 * Deliberately free of imports: these are the pieces worth unit-testing, and
 * pulling in the config module would make every test require a real .env
 * (the config module fails fast on missing credentials, by design).
 * Anything needing credentials or the network lives in `webhooks.ts`.
 */

export type TransmissionHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

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
    return hostname === 'paypal.com' || hostname.endsWith('.paypal.com');
  } catch {
    return false;
  }
}

/**
 * Builds the verification payload as a string so `webhook_event` keeps
 * PayPal's exact bytes: re-serializing a parsed object can reorder keys or
 * change number formatting and fail verification.
 */
export function buildVerificationPayload(
  headers: TransmissionHeaders,
  webhookId: string,
  rawBody: string,
): string {
  return (
    '{' +
    `"auth_algo":${JSON.stringify(headers.authAlgo)},` +
    `"cert_url":${JSON.stringify(headers.certUrl)},` +
    `"transmission_id":${JSON.stringify(headers.transmissionId)},` +
    `"transmission_sig":${JSON.stringify(headers.transmissionSig)},` +
    `"transmission_time":${JSON.stringify(headers.transmissionTime)},` +
    `"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${rawBody}` +
    '}'
  );
}
