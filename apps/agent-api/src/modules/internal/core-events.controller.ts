import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV, Env } from '../../config/env';
import { header } from '../../common/auth/request-context';
import { hmacHex, safeEqualHex } from '../../common/crypto/secrets';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CashInService } from '../operations/cash-in.service';

const EventSchema = z.object({
  type: z.enum(['deposit_request.confirmed', 'deposit_request.rejected']),
  deposit_request_id: z.string().min(4),
  agent_transaction_id: z.string().uuid()
});

const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Events from BataPay Core (e.g. "the customer confirmed the deposit").
 * In production this route is only reachable on the private network with
 * mTLS; the HMAC signature over "timestamp.body" is an extra check and
 * prevents replays of old events.
 */
@Controller('internal/v1')
export class CoreEventsController {
  constructor(
    private readonly cashIn: CashInService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  @Post('core-events')
  @HttpCode(200)
  async handle(@Req() req: FastifyRequest) {
    const ts = header(req, 'x-core-timestamp') ?? '';
    const signature = header(req, 'x-core-signature') ?? '';
    const raw = req.rawBody?.toString('utf8') ?? '';
    const expected = hmacHex(this.env.CORE_EVENTS_HMAC_SECRET, `${ts}.${raw}`);
    if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqualHex(signature, expected)) throw Errors.unauthenticated();
    if (!Number.isFinite(Number(ts)) || Math.abs(this.clock.now().getTime() - Number(ts)) > MAX_AGE_MS) throw Errors.unauthenticated();

    const event = EventSchema.parse(JSON.parse(raw));
    const result =
      event.type === 'deposit_request.confirmed'
        ? await this.cashIn.onCustomerConfirmed(event.deposit_request_id, event.agent_transaction_id)
        : await this.cashIn.onCustomerRejected(event.deposit_request_id, event.agent_transaction_id);
    return { result };
  }
}
