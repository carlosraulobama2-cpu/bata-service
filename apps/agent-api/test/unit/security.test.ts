import { generateKeyPairSync, sign } from 'node:crypto';
import { JwtService } from '../../src/common/auth/jwt';
import { canonicalRequest, parsePublicJwk, verifySignature } from '../../src/common/auth/device-signature';
import { isAcceptablePin, PinHasher } from '../../src/common/crypto/secrets';
import { operatingPeriods } from '../../src/common/time/clock';

const pem = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('JwtService', () => {
  const claims = { sub: 'a', aid: 'AG-000001', sid: 's', did: 'd', role: 'AGENT' as const, aal: 'pin' };

  it('signs and verifies ES256 tokens', () => {
    const jwt = new JwtService(pem(), 'iss', 'aud', 600);
    const now = new Date();
    const { token } = jwt.sign(claims, now);
    expect(jwt.verify(token, now)).toMatchObject({ sub: 'a', aid: 'AG-000001', iss: 'iss', aud: 'aud' });
  });

  it('rejects expiry, other keys, other audiences and alg tricks', () => {
    const key = pem();
    const jwt = new JwtService(key, 'iss', 'aud', 600);
    const now = new Date();
    const { token } = jwt.sign(claims, now);
    expect(jwt.verify(token, new Date(now.getTime() + 601_000))).toBeNull();
    expect(new JwtService(pem(), 'iss', 'aud', 600).verify(token, now)).toBeNull();
    expect(new JwtService(key, 'iss', 'other', 600).verify(token, now)).toBeNull();
    const [, p, s] = token.split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(jwt.verify(`${none}.${p}.${s}`, now)).toBeNull();
    expect(jwt.verify(`${none}.${p}.`, now)).toBeNull();
  });

  it('refuses non-P-256 keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => new JwtService(rsa, 'i', 'a', 60)).toThrow('ES256');
  });
});

describe('device signatures', () => {
  it('verifies a DER ECDSA signature over the canonical request', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = parsePublicJwk(publicKey.export({ format: 'jwk' }))!;
    const data = canonicalRequest('post', '/agent/v1/cash-out', '{"a":1}', '1700000000000', 'key-123');
    expect(data.split('\n')[0]).toBe('POST');
    const sig = sign('sha256', Buffer.from(data), privateKey).toString('base64url');
    expect(verifySignature(JSON.stringify(jwk), data, sig)).toBe(true);
    const otherBody = canonicalRequest('post', '/agent/v1/cash-out', '{"a":2}', '1700000000000', 'key-123');
    expect(otherBody).not.toBe(data);
    expect(verifySignature(JSON.stringify(jwk), otherBody, sig)).toBe(false);
    expect(verifySignature(JSON.stringify(jwk), canonicalRequest('post', '/agent/v1/cash-in', '{"a":1}', '1700000000000', 'key-123'), sig)).toBe(false);
  });

  it('rejects private keys and non-EC keys as device keys', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(parsePublicJwk(privateKey.export({ format: 'jwk' }))).toBeNull();
    expect(parsePublicJwk({ kty: 'RSA', n: 'x', e: 'AQAB' })).toBeNull();
    expect(parsePublicJwk(null)).toBeNull();
  });
});

describe('PIN', () => {
  it('hashes with argon2id + pepper; a different pepper does not verify', async () => {
    const hash = await new PinHasher('pepper-a-0123456789abcdef0123456789').hash('482913');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await new PinHasher('pepper-a-0123456789abcdef0123456789').verify(hash, '482913')).toBe(true);
    expect(await new PinHasher('pepper-a-0123456789abcdef0123456789').verify(hash, '482914')).toBe(false);
    expect(await new PinHasher('pepper-b-0123456789abcdef0123456789').verify(hash, '482913')).toBe(false);
  });

  it.each([
    ['482913', true],
    ['111111', false],
    ['123456', false],
    ['654321', false],
    ['12345', false],
    ['12a456', false]
  ])('isAcceptablePin(%s) = %s', (pin, ok) => {
    expect(isAcceptablePin(pin)).toBe(ok);
  });
});

describe('operating periods', () => {
  it('uses the Malabo calendar day (UTC+1)', () => {
    expect(operatingPeriods(new Date('2026-09-26T23:30:00Z'), 'Africa/Malabo')).toEqual({ day: '2026-09-27', monthStart: '2026-09-01' });
    expect(operatingPeriods(new Date('2026-09-30T23:30:00Z'), 'Africa/Malabo')).toEqual({ day: '2026-10-01', monthStart: '2026-10-01' });
  });
});
