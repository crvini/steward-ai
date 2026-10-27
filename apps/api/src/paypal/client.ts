/**
 * PayPal REST client. Every call this server makes to PayPal goes through here.
 *
 * Server-side only — it reads PAYPAL_CLIENT_SECRET. The browser never sees more
 * than the short-lived, domain-bound client token minted by `browserSafeClientToken()`.
 *
 * Patterns adapted from the official hackathon template (see docs/REFERENCES.md):
 * cached OAuth token refreshed early, one retry on 401, backoff on 429/5xx.
 */
import { env } from '../config/env.js';

const BASE_URL =
  env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'PayPalApiError';
  }
}

type TokenResponse = { access_token: string; expires_in: number };

let cachedToken: { value: string; expiresAt: number } | undefined;

function basicAuth(): string {
  return Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
}

async function requestToken(responseType?: 'client_token'): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (responseType) body.set('response_type', responseType);

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());
  return (await res.json()) as TokenResponse;
}

/** Server-to-server access token, cached and refreshed a minute before it expires. */
export async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { access_token, expires_in } = await requestToken();
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/**
 * Browser-safe token for the JS SDK v6 (`paypal.createInstance({ clientToken })`).
 * Not cached: it is domain-bound and short-lived, and the browser asks for a fresh
 * one each time it initializes the SDK.
 */
export async function browserSafeClientToken(): Promise<{ token: string; expiresIn: number }> {
  const { access_token, expires_in } = await requestToken('client_token');
  return { token: access_token, expiresIn: expires_in };
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** An object is serialized; a string is sent verbatim. */
  body?: unknown;
  /** Sent as `PayPal-Request-Id`, which makes a retried create idempotent. */
  requestId?: string;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, requestId } = options;

  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId;

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });

    if (res.ok) {
      // 204 No Content has no body to parse.
      return (res.status === 204 ? undefined : await res.json()) as T;
    }

    // A revoked or expired token: drop it and mint a new one, once.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

export const paypal = {
  baseUrl: BASE_URL,
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, requestId?: string) =>
    request<T>(path, { method: 'POST', body, requestId }),
  /** Posts a pre-serialized body, for payloads whose exact bytes matter. */
  postRaw: <T>(path: string, body: string) => request<T>(path, { method: 'POST', body }),
};

/** Used by /health: proves the credentials actually mint a token. */
export async function pingPayPal(): Promise<{ environment: string }> {
  await accessToken();
  return { environment: env.PAYPAL_ENV };
}
