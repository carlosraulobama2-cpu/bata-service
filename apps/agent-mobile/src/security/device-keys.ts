import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';
import { fromHex, toBase64Url, toHex, utf8 } from './bytes';
import { KEYS, secureStorage } from './storage';

/**
 * Device keys (docs/06-seguridad.md §3). ECDSA P-256, signatures in DER,
 * verified by the server with the public key registered at OTP time.
 *
 * Interim implementation: the private key is generated here and stored
 * in the OS keystore through expo-secure-store; it is loaded into memory
 * only to sign. The planned hardening is a native module that generates
 * and uses the key inside Android Keystore / Secure Enclave so it never
 * leaves the hardware (same public interface, same server contract).
 */
export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

function newSecretKey(): Uint8Array {
  // Retry until the random bytes are a valid scalar (probability of retry ≈ 2^-32).
  for (;;) {
    const candidate = Crypto.getRandomBytes(32);
    if (p256.utils.isValidSecretKey(candidate)) return candidate;
  }
}

export function publicJwk(secretKey: Uint8Array): PublicJwk {
  const pub = p256.getPublicKey(secretKey, false); // 0x04 || X(32) || Y(32)
  return { kty: 'EC', crv: 'P-256', x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)) };
}

/** ECDSA-SHA256, DER-encoded, base64url. */
export function signWith(secretKey: Uint8Array, data: string): string {
  const compact = p256.sign(utf8(data), secretKey, { prehash: true });
  return toBase64Url(p256.Signature.fromBytes(compact, 'compact').toBytes('der'));
}

export function sha256Hex(data: string): string {
  return toHex(sha256(utf8(data)));
}

/** Creates fresh keys for a device registration. Nothing is stored until the server accepts them. */
export function createDeviceKeys() {
  const device = newSecretKey();
  const biometric = newSecretKey();
  return { device, biometric, devicePublic: publicJwk(device), biometricPublic: publicJwk(biometric) };
}

export async function storeDeviceKeys(keys: { device: Uint8Array; biometric: Uint8Array }): Promise<{ biometricEnabled: boolean }> {
  await secureStorage.set(KEYS.deviceKey, toHex(keys.device));
  const biometricEnabled = await secureStorage.setBiometricProtected(KEYS.biometricKey, toHex(keys.biometric));
  return { biometricEnabled };
}

export async function signWithDeviceKey(data: string): Promise<string> {
  const hex = await secureStorage.get(KEYS.deviceKey);
  if (!hex) throw new Error('DEVICE_KEY_MISSING');
  return signWith(fromHex(hex), data);
}

/** Prompts for fingerprint/face (OS dialog) and signs. Returns null if cancelled or unavailable. */
export async function signWithBiometricKey(data: string, prompt: string): Promise<string | null> {
  try {
    const hex = await secureStorage.getBiometricProtected(KEYS.biometricKey, prompt);
    return hex ? signWith(fromHex(hex), data) : null;
  } catch {
    return null;
  }
}

export async function clearDeviceKeys(): Promise<void> {
  await secureStorage.remove(KEYS.deviceKey);
  await secureStorage.removeBiometricProtected(KEYS.biometricKey).catch(() => undefined);
}

export async function installationId(): Promise<string> {
  const existing = await secureStorage.get(KEYS.installationId);
  if (existing) return existing;
  const id = `inst_${toHex(Crypto.getRandomBytes(16))}`;
  await secureStorage.set(KEYS.installationId, id);
  return id;
}
