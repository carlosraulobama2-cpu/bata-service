import { Client } from 'pg';
import { migrate } from '../../scripts/migrate-lib';

export const TEMPLATE_DB = 'bata_agent_api_template';

export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
}

export function urlFor(db: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${db}`;
  return url.toString();
}

/** Builds a template database once per test run; each test file clones it. */
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  await migrate(urlFor(TEMPLATE_DB));
}
