import { RateLimit } from '../../common/rate-limit/rate-limit.policies';
import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV, Env } from '../../config/env';
import { Clock } from '../../common/time/clock';
import { CashInService } from '../operations/cash-in.service';
import { QrService } from '../qr/qr.service';
import { verifyCoreRequest } from './core-signature';

const EventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['deposit_request.confirmed', 'deposit_request.rejected']),
    deposit_request_id: z.string().min(4),
    agent_transaction_id: z.string().uuid()
  }),
  z.object({
    type: z.literal('qr_payment.authorized'),
    payment_request_id: z.string().min(4).max(100),
    qr_id: z.string().uuid(),
    customer_ref: z.string().min(4).max(100),
    customer_masked: z.string().min(4).max(20),
    amount: z.number().int().positive(),
    currency: z.string().length(3)
  })
]);

const QrResolveSchema = z.object({ payload: z.string().min(6).max(500) });

/** Internal API used by Velynt Core (docs/05-api.md §17). */
@RateLimit('none')
@Controller('internal/v1')
export class CoreEventsController {
  constructor(
    private readonly cashIn: CashInService,
    private readonly qr: QrService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  @Post('core-events')
  @HttpCode(200)
  async handle(@Req() req: FastifyRequest) {
    const event = EventSchema.parse(JSON.parse(verifyCoreRequest(req, this.env, this.clock)));
    switch (event.type) {
      case 'deposit_request.confirmed':
        return { result: await this.cashIn.onCustomerConfirmed(event.deposit_request_id, event.agent_transaction_id) };
      case 'deposit_request.rejected':
        return { result: await this.cashIn.onCustomerRejected(event.deposit_request_id, event.agent_transaction_id) };
      case 'qr_payment.authorized':
        return this.qr.onPaymentAuthorized(event);
    }
  }

  /** The customer scanned an agent QR in Velynt: what should they be shown before paying? */
  @Post('qr/resolve')
  @HttpCode(200)
  async resolveQr(@Req() req: FastifyRequest) {
    const input = QrResolveSchema.parse(JSON.parse(verifyCoreRequest(req, this.env, this.clock)));
    return this.qr.resolveForCore(input.payload);
  }
}
