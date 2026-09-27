import { generateKeyPairSync, randomBytes } from 'node:crypto';

// Prints development-only secrets for .env. Production keys live in KMS/HSM.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const secret = () => `dev-only-${randomBytes(24).toString('base64url')}`;
console.log(`JWT_PRIVATE_KEY_PEM="${pem.trim().replace(/\n/g, '\\n')}"`);
console.log(`PIN_PEPPER=${secret()}`);
console.log(`LOOKUP_HMAC_KEY=${secret()}`);
console.log(`CORE_EVENTS_HMAC_SECRET=${secret()}`);
