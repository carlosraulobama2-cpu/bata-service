import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { DeviceSignatureGuard } from '../../common/auth/device-signature.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AgentAuthSchema } from '../auth/auth.dto';
import { StepUpService } from '../auth/step-up.service';
import { SecurityService } from './security.service';

const Pin = z.string().regex(/^\d{6}$/);
const ChangePinSchema = z.object({ current_pin: Pin, new_pin: Pin });
const RevokeOthersSchema = z.object({ agent_auth: AgentAuthSchema });
const HistorySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(200).optional() });

@Controller('agent/v1/security')
@UseGuards(AgentAuthGuard)
export class SecurityController {
  constructor(
    private readonly security: SecurityService,
    private readonly stepUp: StepUpService,
    private readonly idempotency: IdempotencyService
  ) {}

  @Get('overview')
  overview(@CurrentAgent() agent: AgentContext) {
    return this.security.overview(agent);
  }

  @Get('devices')
  devices(@CurrentAgent() agent: AgentContext) {
    return this.security.devices(agent);
  }

  @Get('sessions')
  sessions(@CurrentAgent() agent: AgentContext) {
    return this.security.sessions(agent);
  }

  @Get('access-history')
  history(@CurrentAgent() agent: AgentContext, @Query() raw: unknown) {
    return this.security.accessHistory(agent, HistorySchema.parse(raw));
  }

  /** Close every other session. Requires PIN or biometrics and the device signature. */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  @UseGuards(DeviceSignatureGuard)
  async revokeOthers(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = RevokeOthersSchema.parse(body);
    await this.stepUp.verify(agent, input.agent_auth, req);
    return this.security.revokeOtherSessions(agent, req.ip);
  }

  @Post('pin/change')
  @UseGuards(DeviceSignatureGuard)
  async changePin(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = ChangePinSchema.parse(body);
    // Nothing derived from the PINs goes into the idempotency record (a hash of a 6-digit PIN is brute-forceable).
    const result = await this.idempotency.run(agent.agentId, key, 'POST /security/pin/change', {}, async () => ({ status: 200, body: await this.security.changePin(agent, input, req.ip) }));
    reply.status(result.status);
    return result.body;
  }
}
