import { describe, expect, it } from 'vitest';

import {
  readTransmissionHeaders,
  isTrustedCertUrl,
  buildVerificationPayload,
} from './signature.js';

describe('readTransmissionHeaders', () => {
  const complete = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig-1',
    'paypal-transmission-time': '2026-10-26T12:00:00Z',
  };

  it('reads all five signed headers', () => {
    expect(readTransmissionHeaders(complete)).toEqual({
      authAlgo: 'SHA256withRSA',
      certUrl: complete['paypal-cert-url'],
      transmissionId: 'tx-1',
      transmissionSig: 'sig-1',
      transmissionTime: '2026-10-26T12:00:00Z',
    });
  });

  it('takes the first value when a header repeats', () => {
    const headers = { ...complete, 'paypal-transmission-id': ['first', 'second'] };
    expect(readTransmissionHeaders(headers)?.transmissionId).toBe('first');
  });

  it('returns null when any signed header is missing', () => {
    for (const key of Object.keys(complete)) {
      const partial: Record<string, string | string[] | undefined> = { ...complete };
      delete partial[key];
      expect(readTransmissionHeaders(partial), `missing ${key}`).toBeNull();
    }
  });

  it('returns null for an empty header set', () => {
    expect(readTransmissionHeaders({})).toBeNull();
  });
});

describe('isTrustedCertUrl', () => {
  it('accepts PayPal hosts over https', () => {
    for (const url of [
      'https://api.paypal.com/v1/notifications/certs/CERT-1',
      'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    ]) {
      expect(isTrustedCertUrl(url), url).toBe(true);
    }
  });

  it('rejects a forged cert_url pointing somewhere else', () => {
    for (const url of [
      'https://evil.example.com/cert',
      // Lookalike hosts: the suffix check must not be fooled by a prefix match.
      'https://paypal.com.evil.example/cert',
      'https://notpaypal.com/cert',
      // Plain http would let a network attacker swap the certificate.
      'http://api.paypal.com/v1/notifications/certs/CERT-1',
      'not a url',
      '',
    ]) {
      expect(isTrustedCertUrl(url), url).toBe(false);
    }
  });
});

describe('buildVerificationPayload', () => {
  const headers = {
    authAlgo: 'SHA256withRSA',
    certUrl: 'https://api.sandbox.paypal.com/cert',
    transmissionId: 'tx-1',
    transmissionSig: 'sig-1',
    transmissionTime: '2026-10-26T12:00:00Z',
  };

  it("embeds the event body verbatim, not re-serialized", () => {
    // Key order and spacing differ from anything JSON.stringify would emit.
    const rawBody = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","n":1.50}';
    const payload = buildVerificationPayload(headers, 'WH-ID', rawBody);

    expect(payload).toContain(`"webhook_event":${rawBody}`);
    // Round-tripping would have normalized 1.50 to 1.5 and dropped the spacing.
    expect(payload).toContain('1.50');

    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.webhook_id).toBe('WH-ID');
    expect(parsed.auth_algo).toBe('SHA256withRSA');
  });

  it('escapes header values instead of breaking the JSON', () => {
    const payload = buildVerificationPayload(
      { ...headers, transmissionSig: 'a"b\\c' },
      'WH-ID',
      '{}',
    );
    const parsed = JSON.parse(payload) as { transmission_sig: string };
    expect(parsed.transmission_sig).toBe('a"b\\c');
  });
});
