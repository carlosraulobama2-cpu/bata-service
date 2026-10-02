import { Errors } from './errors/app-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Cursor {
  t: string;
  i: string;
}

/** Opaque keyset cursor over (timestamp, id), newest first. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), i: id })).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof c?.t !== 'string' || Number.isNaN(Date.parse(c.t)) || typeof c?.i !== 'string' || !/^[0-9a-f-]{1,36}$/i.test(c.i)) throw new Error();
    return c;
  } catch {
    throw Errors.validation({ fields: ['cursor'] });
  }
}

export const isUuid = (v: string) => UUID.test(v);
