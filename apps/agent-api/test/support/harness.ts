import 'reflect-metadata';
import { createHash, generateKeyPairSync, KeyObject, randomBytes, randomUUID, sign } from 'node:crypto';
import { Client } from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/bootstrap';
import { Env, loadEnv } from '../../src/config/env';
import { PinHasher } from '../../src/common/crypto/secrets';
import { AGENT_DB, AgentDb } from '../../src/common/db/database';
import { Clock } from '../../src/common/time/clock';
import { CoreClient } from '../../src/integrations/core/core.client';
import { FakeCoreClient } from '../../src/integrations/core/fake-core.client';
import { LedgerClient } from '../../src/integrations/ledger/ledger.client';
import { InMemorySmsSender } from '../../src/integrations/sms/sms.sender';
import { createActiveAgent, seedReferenceData } from '../../scripts/seed-lib';
import { adminUrl, TEMPLATE_DB, urlFor } from './global-setup';

export class TestClock extends Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export interface Device {
  installationId: string;
  privateKey: KeyObject;
  publicJwk: Record<string, unknown>;
  biometricKey: KeyObject;
  biometricJwk: Record<string, unknown>;
}

export function newDevice(): Device {
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const b = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    installationId: `inst_${randomBytes(8).toString('hex')}`,
    privateKey: k.privateKey,
    publicJwk: k.publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
    biometricKey: b.privateKey,
    biometricJwk: b.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  device: Device;
  deviceId: string;
}

export interface Response {
  status: number;
  body: any;
  headers: Record<string, string | string[] | number | undefined>;
}

/** One isolated database + app per test file. */
export class Harness {
  app!: NestFastifyApplication;
  env!: Env;
  db!: AgentDb;
  ledger!: LedgerClient;
  core!: FakeCoreClient;
  sms = new InMemorySmsSender();
  clock = new TestClock();
  staff!: { compliance: string; admin: string; finance: string; finance2: string };
  private dbName = `bata_test_${randomBytes(6).toString('hex')}`;

  static async start(overrides: { wrapLedger?: (real: LedgerClient) => LedgerClient } = {}): Promise<Harness> {
    const h = new Harness();
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${h.dbName} TEMPLATE ${TEMPLATE_DB}`);
    await admin.end();

    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    h.env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: urlFor(h.dbName),
      LEDGER_DATABASE_URL: urlFor(h.dbName),
      CORE_EVENTS_HMAC_SECRET: 'dev-only-test-core-events-secret-0123456789',
      JWT_PRIVATE_KEY_PEM: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      PIN_PEPPER: 'dev-only-test-pepper-0123456789abcdef',
      LOOKUP_HMAC_KEY: 'dev-only-test-lookup-0123456789abcdef',
      ENABLE_DEV_ENDPOINTS: 'false'
    });
    h.app = await createApp(h.env, { clock: h.clock, sms: h.sms, wrapLedger: overrides.wrapLedger });
    h.db = h.app.get(AGENT_DB);
    h.ledger = h.app.get(LedgerClient);
    h.core = h.app.get(CoreClient) as FakeCoreClient;
    ({ staff: h.staff } = await seedReferenceData(h.db, h.ledger));
    return h;
  }

  async stop(): Promise<void> {
    await this.app.close();
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${this.dbName} WITH (FORCE)`);
    await admin.end();
  }

  hasher(): PinHasher {
    return this.app.get(PinHasher);
  }

  async createAgent(phone: string, pin = '482913', float = 1_000_000) {
    return createActiveAgent(this.db, this.ledger, this.hasher(), this.staff, { phone, pin, firstName: 'Carlos', lastName: 'Test', float });
  }

  async request(method: string, url: string, options: { body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}): Promise<Response> {
    const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const res = await this.app.getHttpAdapter().getInstance().inject({
      method: method as any,
      url,
      headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...options.headers },
      payload
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
  }

  /** Full login on a new device: PIN -> OTP by SMS -> device registration. */
  async login(phone: string, pin = '482913', device: Device = newDevice()): Promise<Session> {
    const first = await this.request('POST', '/agent/v1/auth/login', {
      body: { phone, pin, device: { installation_id: device.installationId, platform: 'android', model: 'Samsung Galaxy A14', app_version: '1.0.0' } }
    });
    if (first.body?.status === 'authenticated') {
      return { accessToken: first.body.access_token, refreshToken: first.body.refresh_token, device, deviceId: (await this.deviceId(device)) };
    }
    if (first.body?.status !== 'otp_required') throw new Error(`login failed: ${JSON.stringify(first.body)}`);
    const code = this.sms.lastCodeFor(phone)!;
    const second = await this.request('POST', '/agent/v1/auth/verify-otp', {
      body: { challenge_id: first.body.challenge_id, code, device_keys: { device_public_key: device.publicJwk, biometric_public_key: device.biometricJwk } }
    });
    if (second.status !== 200) throw new Error(`verify-otp failed: ${JSON.stringify(second.body)}`);
    return { accessToken: second.body.access_token, refreshToken: second.body.refresh_token, device, deviceId: second.body.device.id };
  }

  private async deviceId(device: Device): Promise<string> {
    const row = await this.db.selectFrom('agent.agent_devices').select('id').where('installation_id', '=', device.installationId).where('status', '=', 'trusted').executeTakeFirstOrThrow();
    return row.id;
  }

  /** Authenticated GET. */
  get(session: Session, url: string) {
    return this.request('GET', url, { headers: { authorization: `Bearer ${session.accessToken}` } });
  }

  /** Signed financial POST, as the app does it. */
  signedPost(session: Session, path: string, body: unknown, opts: { key?: string; timestamp?: number; tamper?: boolean; signWith?: KeyObject } = {}) {
    const raw = JSON.stringify(body);
    const key = opts.key ?? randomUUID();
    const ts = String(opts.timestamp ?? this.clock.now().getTime());
    const canonical = ['POST', path, createHash('sha256').update(raw).digest('hex'), ts, key].join('\n');
    const signature = sign('sha256', Buffer.from(canonical), opts.signWith ?? session.device.privateKey).toString('base64url');
    return this.request('POST', path, {
      rawBody: opts.tamper ? raw.replace(/\d{3}(?=[,}])/, '999') : raw,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'idempotency-key': key,
        'x-timestamp': ts,
        'x-device-signature': signature,
        'x-device-id': session.deviceId
      }
    });
  }

  biometricSignature(session: Session, path: string, key: string, ts: number): string {
    return sign('sha256', Buffer.from(['POST', path, String(ts), key].join('\n')), session.device.biometricKey).toString('base64url');
  }

  /** Signs a Core event exactly like BataPay Core would. */
  coreEvent(event: Record<string, unknown>, opts: { secret?: string; timestamp?: number } = {}) {
    const raw = JSON.stringify(event);
    const ts = String(opts.timestamp ?? this.clock.now().getTime());
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', opts.secret ?? this.env.CORE_EVENTS_HMAC_SECRET).update(`${ts}.${raw}`).digest('hex');
    return this.request('POST', '/internal/v1/core-events', { rawBody: raw, headers: { 'x-core-timestamp': ts, 'x-core-signature': sig } });
  }

  async balance(ownerType: string, ownerRef: string, purpose: string) {
    return this.ledger.getBalance({ ownerType: ownerType as any, ownerRef, purpose, currency: 'XAF' });
  }
}

export const PIN = '482913';
