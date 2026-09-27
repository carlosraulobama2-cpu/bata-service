import { RateLimit } from '../../common/rate-limit/rate-limit.policies';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { hmacHex } from '../../common/crypto/secrets';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { FakeCoreClient } from '../../integrations/core/fake-core.client';
import { CoreClient } from '../../integrations/core/core.client';
import { InMemorySmsSender, SmsSender } from '../../integrations/sms/sms.sender';
import { CashInService } from '../operations/cash-in.service';
import { QrService } from '../qr/qr.service';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../../config/env';

/**
 * Development-only helpers that simulate what BataPay Core and the
 * customer's app would do, so the agent app can be built end to end.
 * Registered only when ENABLE_DEV_ENDPOINTS=true, which config refuses in
 * production.
 */
@RateLimit('none')
@Controller('dev')
export class DevController {
  constructor(
    private readonly core: CoreClient,
    private readonly sms: SmsSender,
    private readonly cashIn: CashInService,
    private readonly qr: QrService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  private fake(): FakeCoreClient {
    if (!(this.core instanceof FakeCoreClient)) throw Errors.forbidden();
    return this.core;
  }

  @Post('customers')
  async addCustomer(@Body() body: unknown) {
    const input = z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/), balance: z.number().int().nonnegative().default(0) }).parse(body);
    const ref = await this.fake().addCustomer(input.phone, 'XAF', input.balance);
    return { customer_ref: ref, customer_token: this.fake().issueCustomerToken(ref), customer_qr: this.fake().issueCustomerQr(ref) };
  }

  @Post('withdrawals')
  async createWithdrawal(@Body() body: unknown) {
    const input = z.object({ phone: z.string(), amount: z.number().int().positive() }).parse(body);
    const customer = await this.fake().resolveCustomer({ phone: input.phone });
    if (!customer) throw Errors.notFound();
    return this.fake().createWithdrawal(customer.customerRef, input.amount);
  }

  /** Simulates the customer tapping "Confirmar" in the BataPay app. */
  @Post('deposits/confirm')
  async confirmDeposit(@Body() body: unknown) {
    const input = z.object({ agent_transaction_id: z.string().uuid() }).parse(body);
    const deposit = [...this.fake().deposits.values()].find((d) => d.agentTransactionId === input.agent_transaction_id);
    if (!deposit) throw Errors.notFound();
    return { result: await this.cashIn.onCustomerConfirmed(deposit.id, input.agent_transaction_id) };
  }

  /**
   * Simulates a customer paying an agent's collect QR in the BataPay app:
   * resolve the QR, approve with PIN (hold in the wallet), Core reports it.
   */
  @Post('qr/pay')
  async payQr(@Body() body: unknown) {
    const input = z.object({ payload: z.string(), phone: z.string().regex(/^\+[1-9]\d{6,14}$/).default('+240555000999') }).parse(body);
    const qr = await this.qr.resolveForCore(input.payload);
    if (qr.kind !== 'collect' || !qr.amount) throw Errors.qrInvalid();
    const customerRef = await this.fake().addCustomer(input.phone, qr.currency, 1_000_000);
    const payment = await this.fake().authorizeQrPayment(customerRef, qr.amount, qr.currency);
    return this.qr.onPaymentAuthorized({
      payment_request_id: payment.paymentRequestId,
      qr_id: qr.qr_id,
      customer_ref: customerRef,
      customer_masked: payment.masked,
      amount: qr.amount,
      currency: qr.currency
    });
  }

  @Get('otp')
  lastOtp(@Query('phone') phone: string) {
    if (!(this.sms instanceof InMemorySmsSender)) throw Errors.forbidden();
    return { code: this.sms.lastCodeFor(phone) };
  }

  /** Signs a Core event like BataPay Core would (for manual testing of /internal/v1/core-events). */
  @Post('sign-core-event')
  sign(@Body() body: unknown) {
    const raw = JSON.stringify(body);
    const ts = String(this.clock.now().getTime());
    return { raw, headers: { 'x-core-timestamp': ts, 'x-core-signature': hmacHex(this.env.CORE_EVENTS_HMAC_SECRET, `${ts}.${raw}`) } };
  }
}
