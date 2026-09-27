import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomNumericCode(digits: number): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/**
 * PIN hashing: argon2id over HMAC(pepper, pin). The pepper lives outside
 * the database (KMS/HSM in production), so a stolen database alone is not
 * enough to brute-force the 10^6 possible 6-digit PINs.
 */
export class PinHasher {
  private static readonly OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
  private dummyHash?: Promise<string>;

  constructor(private readonly pepper: string) {}

  private peppered(pin: string): string {
    return hmacHex(this.pepper, pin);
  }

  hash(pin: string): Promise<string> {
    return argon2.hash(this.peppered(pin), PinHasher.OPTIONS);
  }

  verify(hash: string, pin: string): Promise<boolean> {
    return argon2.verify(hash, this.peppered(pin));
  }

  /** Burns the same time as a real check when the account doesn't exist. */
  async verifyDummy(pin: string): Promise<false> {
    this.dummyHash ??= this.hash('000000-not-a-real-pin');
    await argon2.verify(await this.dummyHash, this.peppered(pin));
    return false;
  }
}

/** PIN rules: exactly 6 digits, not all equal, not a straight sequence. */
export function isAcceptablePin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false;
  const asc = '0123456789012345';
  const desc = '9876543210987654';
  return !asc.includes(pin) && !desc.includes(pin);
}
