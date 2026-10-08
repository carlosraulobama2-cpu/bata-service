import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit/audit.service';
import type { AgentContext, RequestMeta } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CoreClient } from '../../integrations/core/core.client';
import { maskPhone } from '@bata/money';
import { assertCanOperate } from '../operations/cash-out.service';

/** "No match" checks allowed per agent in the window before a pause (anti-guessing). */
const MAX_FAILED_CHECKS = 10;
const WINDOW_MINUTES = 10;

export interface VerifiedCustomerView {
  status: 'verified';
  customer: { token: string; display_name: string; phone_masked: string; verified_at: string | null };
  token_expires_at: string;
}

/**
 * Before a deposit, the agent types the customer's name and phone. BataPay
 * Core confirms the customer exists, the name matches, and the customer's
 * verification (approved by BataPay staff in the control panel) is
 * complete. "Not found" and "name doesn't match" give the same answer so
 * the endpoint cannot be used to discover who has an account.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly core: CoreClient,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  private async recentFailures(agentId: string): Promise<number> {
    const since = new Date(this.clock.now().getTime() - WINDOW_MINUTES * 60000);
    const row = await this.db
      .selectFrom('agent.agent_audit_logs')
      .select(sql<number>`COUNT(*)::int`.as('n'))
      .where('agent_id', '=', agentId)
      .where('action', '=', 'CUSTOMER_VERIFY')
      // Only "no match" counts: a correct name + phone of a not-yet-verified customer is not guessing.
      .where('reason_code', '=', 'CUSTOMER_NOT_FOUND')
      .where('occurred_at', '>=', since)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  async verify(agent: AgentContext, input: { phone: string; full_name: string }, meta: RequestMeta): Promise<VerifiedCustomerView> {
    assertCanOperate(agent);
    if ((await this.recentFailures(agent.agentId)) >= MAX_FAILED_CHECKS) throw Errors.rateLimited({ retry_after_minutes: WINDOW_MINUTES });

    const result = await this.core.verifyCustomer({ phone: input.phone, fullName: input.full_name });
    const record = (outcome: 'success' | 'failure' | 'denied', reasonCode?: string) =>
      this.audit.record(this.db, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'CUSTOMER_VERIFY',
        resourceType: 'customer',
        resourceId: result?.customerRef ?? null,
        result: outcome,
        reasonCode,
        deviceId: agent.deviceId,
        ip: meta.ip,
        requestId: meta.requestId,
        // Never the typed name; only the masked phone.
        metadata: { phone_masked: maskPhone(input.phone) }
      });

    if (!result) {
      await record('failure', 'CUSTOMER_NOT_FOUND');
      throw Errors.customerNotFound();
    }
    if (!result.canReceive) {
      await record('denied', 'CUSTOMER_UNAVAILABLE');
      throw Errors.customerUnavailable();
    }
    if (result.kycStatus !== 'verified') {
      await record('denied', 'CUSTOMER_NOT_VERIFIED');
      throw Errors.customerNotVerified({ kyc_status: result.kycStatus, display_name: result.displayName });
    }
    await record('success');
    return {
      status: 'verified',
      customer: {
        token: result.customerToken,
        display_name: result.displayName,
        phone_masked: result.masked,
        verified_at: result.verifiedAt?.toISOString() ?? null
      },
      token_expires_at: result.tokenExpiresAt.toISOString()
    };
  }
}
