import { createPublicKey, createHash, verify } from 'node:crypto';

// Deterministic, test-only randomness source for expo-crypto.
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)),
  randomUUID: () => require('node:crypto').randomUUID()
}));

import { createDeviceKeys, publicJwk, sha256Hex, signWith } from '../security/device-keys';
import { toBase64Url } from '../security/bytes';

describe('device keys (app side) are accepted by the server verifier', () => {
  it('produces a P-256 public JWK that node:crypto can import', () => {
    const keys = createDeviceKeys();
    expect(keys.devicePublic).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(() => createPublicKey({ key: keys.devicePublic, format: 'jwk' })).not.toThrow();
    expect(keys.devicePublic).not.toHaveProperty('d');
    expect(publicJwk(keys.device)).toEqual(keys.devicePublic);
  });

  it('signs the canonical request exactly as the API verifies it (ECDSA-SHA256, DER)', () => {
    const { device, devicePublic } = createDeviceKeys();
    const body = JSON.stringify({ withdrawal_request_id: 'wdr_1', amount: 50000, currency: 'XAF', agent_auth: { method: 'pin', pin: '482913' } });
    const canonical = ['POST', '/agent/v1/cash-out', sha256Hex(body), '1790000000000', 'key-123'].join('\n');
    const signature = signWith(device, canonical);

    // Same check as apps/agent-api/src/common/auth/device-signature.ts
    const key = createPublicKey({ key: devicePublic, format: 'jwk' });
    expect(verify('sha256', Buffer.from(canonical), key, Buffer.from(signature, 'base64url'))).toBe(true);
    const tamperedBody = body.replace('50000', '50001');
    const tampered = ['POST', '/agent/v1/cash-out', sha256Hex(tamperedBody), '1790000000000', 'key-123'].join('\n');
    expect(tampered).not.toBe(canonical);
    expect(verify('sha256', Buffer.from(tampered), key, Buffer.from(signature, 'base64url'))).toBe(false);
  });

  it('hashes bodies like the server (sha256 hex of UTF-8)', () => {
    const body = '{"name":"Málaga"}';
    expect(sha256Hex(body)).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
  });

  it('encodes base64url like Buffer', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33, 64, 65]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256));
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });
});
