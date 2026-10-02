import { createPublicKey, verify } from 'node:crypto';
import { sha256Hex } from '../crypto/secrets';

type JsonWebKey = { kty?: string; crv?: string; x?: string; y?: string; d?: string };

/**
 * Canonical string signed by the device key for financial operations:
 *   METHOD \n PATH \n SHA256(body) \n X-Timestamp \n Idempotency-Key
 * Signatures are ECDSA P-256 / SHA-256 in DER encoding (what Android
 * Keystore and the iOS Secure Enclave produce), base64url.
 */
export function canonicalRequest(method: string, path: string, rawBody: string, timestamp: string, idempotencyKey: string): string {
  return [method.toUpperCase(), path, sha256Hex(rawBody), timestamp, idempotencyKey].join('\n');
}

export function parsePublicJwk(value: unknown): JsonWebKey | null {
  if (!value || typeof value !== 'object') return null;
  const jwk = value as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
  if ('d' in jwk) return null; // never accept a private key
  try {
    createPublicKey({ key: jwk, format: 'jwk' });
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  } catch {
    return null;
  }
}

export function verifySignature(publicJwkJson: string, data: string, signatureB64url: string): boolean {
  try {
    const key = createPublicKey({ key: JSON.parse(publicJwkJson), format: 'jwk' });
    return verify('sha256', Buffer.from(data), key, Buffer.from(signatureB64url, 'base64url'));
  } catch {
    return false;
  }
}
