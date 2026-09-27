import { Pool, PoolClient } from 'pg';
import {
  AccountRef,
  Balance,
  LedgerClient,
  LedgerInsufficientFundsError,
  LedgerRejectedError,
  PostTransactionInput
} from './ledger.client';

const PREFIX: Record<string, string> = {
  customer_wallet: 'CUS',
  agent_float: 'AGF',
  agent_commission_payable: 'AGC',
  settlement_bank: 'SYS-BANK',
  commission_expense: 'SYS-COMEXP',
  fee_revenue: 'SYS-FEEREV'
};

/** Calls the ledger schema's functions (db/01_ledger.sql) directly. */
export class LocalLedgerClient extends LedgerClient {
  readonly sourceSystem = 'agent-service';
  private readonly pool: Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString, max: 10 });
  }

  private async accountId(client: Pool | PoolClient, ref: AccountRef): Promise<string> {
    const { rows } = await client.query(
      `SELECT id FROM ledger.ledger_accounts WHERE owner_type = $1 AND owner_ref = $2 AND purpose = $3 AND currency = $4`,
      [ref.ownerType, ref.ownerRef, ref.purpose, ref.currency]
    );
    if (!rows[0]) throw new LedgerRejectedError(`Ledger account not found: ${ref.ownerType}/${ref.ownerRef}/${ref.purpose}`);
    return rows[0].id;
  }

  private async translate<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const insufficient = /LEDGER_INSUFFICIENT_FUNDS: account (\S+)/.exec(message);
      if (insufficient) {
        const { rows } = await this.pool.query(
          `SELECT owner_type, owner_ref, purpose, currency FROM ledger.ledger_accounts WHERE account_number = $1`,
          [insufficient[1]]
        );
        const r = rows[0];
        throw new LedgerInsufficientFundsError(r ? { ownerType: r.owner_type, ownerRef: r.owner_ref, purpose: r.purpose, currency: r.currency } : null);
      }
      if (/LEDGER_[A-Z_]+/.test(message)) throw new LedgerRejectedError(message);
      throw err; // connection problems etc.: the caller treats them as "unknown outcome"
    }
  }

  async openAccount(ref: AccountRef, type: 'asset' | 'liability' | 'revenue' | 'expense', options: { trackBalance?: boolean } = {}): Promise<string> {
    const number = `${PREFIX[ref.purpose] ?? ref.purpose.toUpperCase()}-${ref.ownerRef}-${ref.currency}`.replace(/[^A-Za-z0-9-]/g, '');
    const { rows } = await this.pool.query(
      `INSERT INTO ledger.ledger_accounts (account_number, owner_type, owner_ref, purpose, type, currency, track_balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_type, owner_ref, purpose, currency) DO UPDATE SET owner_ref = EXCLUDED.owner_ref
       RETURNING id`,
      [number, ref.ownerType, ref.ownerRef, ref.purpose, type, ref.currency, options.trackBalance ?? true]
    );
    return rows[0].id;
  }

  createHold(input: { account: AccountRef; amount: number; externalRef: string; expiresAt: Date; sourceSystem?: string }): Promise<string> {
    return this.translate(async () => {
      const accountId = await this.accountId(this.pool, input.account);
      const { rows } = await this.pool.query(`SELECT ledger.create_hold($1, $2, $3, $4, $5) AS id`, [
        accountId,
        input.amount,
        input.sourceSystem ?? this.sourceSystem,
        input.externalRef,
        input.expiresAt
      ]);
      return rows[0].id;
    });
  }

  closeHold(input: { account: AccountRef; externalRef: string; status: 'released' | 'expired'; sourceSystem?: string }): Promise<void> {
    return this.translate(async () => {
      const accountId = await this.accountId(this.pool, input.account);
      const { rows } = await this.pool.query(
        `SELECT id FROM ledger.ledger_holds WHERE source_system = $1 AND external_ref = $2 AND account_id = $3`,
        [input.sourceSystem ?? this.sourceSystem, input.externalRef, accountId]
      );
      if (rows[0]) await this.pool.query(`SELECT ledger.close_hold($1, $2)`, [rows[0].id, input.status]);
    });
  }

  post(input: PostTransactionInput): Promise<{ transactionId: string }> {
    return this.translate(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const entries = [];
        for (const e of input.entries) {
          if (e.amount === 0) continue; // e.g. zero commission
          entries.push({ account_id: await this.accountId(client, e.account), direction: e.direction, amount: e.amount });
        }
        const holdIds: string[] = [];
        for (const h of input.captureHolds ?? []) {
          const accountId = await this.accountId(client, h.account);
          const { rows } = await client.query(
            `SELECT id FROM ledger.ledger_holds WHERE source_system = $1 AND external_ref = $2 AND account_id = $3`,
            [h.sourceSystem, h.externalRef, accountId]
          );
          if (!rows[0]) throw new LedgerRejectedError(`LEDGER_HOLD_NOT_FOUND: ${h.externalRef}`);
          holdIds.push(rows[0].id);
        }
        const { rows } = await client.query(
          `SELECT ledger.post_transaction($1, $2, $3, $4, $5::jsonb, $6, $7, $8, '{}'::jsonb, $9::uuid[]) AS id`,
          [
            input.reference,
            this.sourceSystem,
            input.idempotencyKey,
            input.kind,
            JSON.stringify(entries),
            `svc:${this.sourceSystem}`,
            input.externalRef,
            input.description ?? null,
            holdIds
          ]
        );
        await client.query('COMMIT');
        return { transactionId: rows[0].id };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
  }

  async findTransaction(idempotencyKey: string): Promise<{ transactionId: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM ledger.ledger_transactions WHERE source_system = $1 AND idempotency_key = $2`,
      [this.sourceSystem, idempotencyKey]
    );
    return rows[0] ? { transactionId: rows[0].id } : null;
  }

  async getBalance(account: AccountRef): Promise<Balance> {
    const { rows } = await this.pool.query(
      `SELECT b.balance, b.held FROM ledger.ledger_account_balances b
       JOIN ledger.ledger_accounts a ON a.id = b.account_id
       WHERE a.owner_type = $1 AND a.owner_ref = $2 AND a.purpose = $3 AND a.currency = $4`,
      [account.ownerType, account.ownerRef, account.purpose, account.currency]
    );
    if (!rows[0]) return { balance: 0, held: 0, available: 0 };
    const balance = Number(rows[0].balance);
    const held = Number(rows[0].held);
    return { balance, held, available: balance - held };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
