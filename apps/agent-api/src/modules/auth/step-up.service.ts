import { Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AgentContext } from '../../common/auth/request-context';
import { header } from '../../common/auth/request-context';
import { verifySignature } from '../../common/auth/device-signature';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { AgentAuthInput } from './auth.dto';
import { CredentialsService } from './credentials.service';

/**
 * Confirms that the agent is present for a money operation: PIN checked
 * on the server, or a signature from the biometric-protected key over
 * METHOD\nPATH\nX-Timestamp\nIdempotency-Key.
 */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly credentials: CredentialsService
  ) {}

  async verify(agent: AgentContext, auth: AgentAuthInput, req: FastifyRequest): Promise<'pin' | 'biometric'> {
    if (auth.method === 'pin') {
      const check = await this.credentials.verifyPin(agent.agentId, auth.pin);
      if (!check.ok) {
        if (check.lockedUntil) throw Errors.accountLocked({ locked_until: check.lockedUntil.toISOString() });
        throw Errors.pinInvalid({ attempts_left: check.attemptsLeft });
      }
      return 'pin';
    }
    const device = await this.db.selectFrom('agent.agent_devices').select(['biometric_public_key']).where('id', '=', agent.deviceId).executeTakeFirst();
    if (!device?.biometric_public_key) throw Errors.biometricInvalid();
    const path = req.url.split('?')[0] ?? req.url;
    const data = [req.method.toUpperCase(), path, header(req, 'x-timestamp') ?? '', header(req, 'idempotency-key') ?? ''].join('\n');
    if (!verifySignature(device.biometric_public_key, data, auth.signature)) throw Errors.biometricInvalid();
    return 'biometric';
  }
}
