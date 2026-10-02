import { createPrivateKey, createPublicKey, KeyObject, randomBytes, sign, verify } from 'node:crypto';

/**
 * QR content (docs/05-api.md §9):
 *
 *   BSV1.<type>.<id>[.<signature>]
 *
 *   A = agent static · K = collect (cobro)  → issued and signed here (Ed25519)
 *   C = customer     · W = withdrawal       → issued by Velynt Core, validated by Core
 *
 * The id is 128 random bits (base64url). The QR never carries amounts or
 * personal data: everything is read from the server. The signature lets
 * anyone holding the public key discard forged codes offline, but whether a
 * code is still valid is always decided by the server.
 */
export type QrType = 'A' | 'K' | 'C' | 'W';

export interface ParsedQr {
  type: QrType;
  id: string;
  signature: string | null;
  raw: string;
}

const PREFIX = 'BSV1';
const OWN_TYPES = new Set<QrType>(['A', 'K']);
const PATTERN = /^BSV1\.([AKCW])\.([A-Za-z0-9_-]{4,100})(?:\.([A-Za-z0-9_-]{20,200}))?$/;

export function parseQr(payload: string): ParsedQr | null {
  const raw = payload.trim();
  const m = PATTERN.exec(raw);
  if (!m) return null;
  return { type: m[1] as QrType, id: m[2]!, signature: m[3] ?? null, raw };
}

export function newQrNonce(): string {
  return randomBytes(16).toString('base64url');
}

export class QrCodec {
  private readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;

  constructor(privateKeyPem: string) {
    this.privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('QR_SIGNING_PRIVATE_KEY_PEM must be an Ed25519 key');
    this.publicKey = createPublicKey(this.privateKey);
  }

  encode(type: 'A' | 'K', nonce: string): string {
    const body = `${PREFIX}.${type}.${nonce}`;
    return `${body}.${sign(null, Buffer.from(body), this.privateKey).toString('base64url')}`;
  }

  /** True only for codes issued (and signed) by this service. */
  verify(qr: ParsedQr): boolean {
    if (!OWN_TYPES.has(qr.type) || !qr.signature) return false;
    try {
      return verify(null, Buffer.from(`${PREFIX}.${qr.type}.${qr.id}`), this.publicKey, Buffer.from(qr.signature, 'base64url'));
    } catch {
      return false;
    }
  }
}
