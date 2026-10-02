import { Injectable } from '@nestjs/common';
import type { AgentDb, AgentTrx } from '../db/database';

export interface AuditEntry {
  actorType: 'agent' | 'staff' | 'system' | 'service';
  actorId: string | null;
  agentId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  result: 'success' | 'failure' | 'denied';
  reasonCode?: string;
  deviceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Never PINs, OTPs, tokens or documents. */
  metadata?: Record<string, unknown>;
}

/**
 * Append-only, hash-chained audit log (the chain is computed by a DB
 * trigger). Pass the business transaction so the log is committed
 * together with the action it describes.
 */
@Injectable()
export class AuditService {
  async record(db: AgentDb | AgentTrx, entry: AuditEntry): Promise<void> {
    await db
      .insertInto('agent.agent_audit_logs')
      .values({
        stream: entry.agentId ? `agent:${entry.agentId}` : `${entry.actorType}:${entry.actorId ?? 'anonymous'}`,
        actor_type: entry.actorType,
        actor_id: entry.actorId,
        agent_id: entry.agentId,
        action: entry.action,
        resource_type: entry.resourceType ?? null,
        resource_id: entry.resourceId ?? null,
        result: entry.result,
        reason_code: entry.reasonCode ?? null,
        device_id: entry.deviceId ?? null,
        ip: entry.ip ?? null,
        user_agent: entry.userAgent?.slice(0, 256) ?? null,
        request_id: entry.requestId ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
        prev_hash: null
      })
      .execute();
  }
}
