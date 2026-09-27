import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const DB_DIR = join(__dirname, '..', '..', '..', 'db');

/**
 * Applies db/NN_*.sql files in order, once each, recording them in
 * public.schema_migrations with a checksum. An already-applied file whose
 * content changed is an error: new changes go in a new numbered file.
 */
export async function migrate(connectionString: string, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const files = readdirSync(DB_DIR).filter((f) => /^\d{2}_.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const sqlText = readFileSync(join(DB_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sqlText).digest('hex');
      const { rows } = await client.query(`SELECT checksum FROM public.schema_migrations WHERE filename = $1`, [file]);
      if (rows[0]) {
        if (rows[0].checksum !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query(`INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)`, [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}
