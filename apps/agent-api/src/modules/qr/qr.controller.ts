import { RateLimit } from '../../common/rate-limit/rate-limit.policies';
import { Body, Controller, Get, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { DeviceSignatureGuard } from '../../common/auth/device-signature.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { QrCreateSchema, QrScanSchema } from './qr.dto';
import { QrService } from './qr.service';

@Controller('agent/v1/qr')
@UseGuards(AgentAuthGuard)
export class QrController {
  constructor(
    private readonly qr: QrService,
    private readonly idempotency: IdempotencyService
  ) {}

  /** Collect QR (creates the pending QR payment) or the agent's static QR. Signed by the device. */
  @Post('create')
  @RateLimit('financial')
  @UseGuards(DeviceSignatureGuard)
  async create(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = QrCreateSchema.parse(body);
    const result = await this.idempotency.run(agent.agentId, key, 'POST /qr/create', input, async () =>
      input.kind === 'collect' ? { status: 201, body: await this.qr.createCollect(agent, input, key!) } : { status: 200, body: await this.qr.staticQr(agent) }
    );
    if (result.replayed) reply.header('Idempotent-Replayed', 'true');
    reply.status(result.status);
    return result.body;
  }

  @Post('scan')
  @RateLimit('code_lookup')
  async scan(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = QrScanSchema.parse(body);
    reply.status(200);
    return this.qr.scan(agent, input.payload);
  }

  @Get(':id')
  get(@CurrentAgent() agent: AgentContext, @Param('id') id: string) {
    return this.qr.get(agent, id);
  }
}
