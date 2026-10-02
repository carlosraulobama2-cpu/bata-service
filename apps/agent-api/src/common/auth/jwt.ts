import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'node:crypto';

/**
 * Minimal ES256 JWT (header.payload.signature) with node:crypto.
 * Only ES256 is accepted when verifying: the "alg" header is checked and
 * never trusted to pick the algorithm.
 */
export interface AccessClaims {
  sub: string; // agent uuid
  aid: string; // agent code (AG-000001)
  sid: string; // session id
  did: string; // device id
  role: 'AGENT';
  aal: string; // authentication level
}

interface RegisteredClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export class JwtService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keyId: string;

  constructor(
    privateKeyPem: string,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly ttlSeconds: number
  ) {
    this.privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
    if (this.privateKey.asymmetricKeyType !== 'ec' || this.privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('JWT key must be an EC P-256 private key (ES256)');
    }
    this.publicKey = createPublicKey(this.privateKey);
    const jwk = this.publicKey.export({ format: 'jwk' });
    this.keyId = `k-${String(jwk.x).slice(0, 12)}`;
  }

  sign(claims: AccessClaims, now: Date): { token: string; expiresIn: number } {
    const iat = Math.floor(now.getTime() / 1000);
    const header = { alg: 'ES256', typ: 'JWT', kid: this.keyId };
    const payload: AccessClaims & RegisteredClaims = {
      ...claims,
      iss: this.issuer,
      aud: this.audience,
      iat,
      exp: iat + this.ttlSeconds
    };
    const input = `${b64(header)}.${b64(payload)}`;
    const signature = sign('sha256', Buffer.from(input), { key: this.privateKey, dsaEncoding: 'ieee-p1363' });
    return { token: `${input}.${signature.toString('base64url')}`, expiresIn: this.ttlSeconds };
  }

  /** Returns the claims, or null if the token is invalid or expired. */
  verify(token: string, now: Date): (AccessClaims & RegisteredClaims) | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    try {
      const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      if (header.alg !== 'ES256' || header.kid !== this.keyId) return null;
      const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: this.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
      if (!ok) return null;
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      const nowSec = Math.floor(now.getTime() / 1000);
      if (payload.iss !== this.issuer || payload.aud !== this.audience) return null;
      if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
      if (payload.role !== 'AGENT') return null;
      return payload;
    } catch {
      return null;
    }
  }
}
