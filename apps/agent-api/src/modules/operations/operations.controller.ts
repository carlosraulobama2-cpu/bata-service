import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { DeviceSignatureGuard } from '../../common/auth/device-signature.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { StepUpService } from '../auth/step-up.service';
import { CashInService } from './cash-in.service';
import { CashOutService } from './cash-out.service';
import { CashInSchema, CashOutResolveSchema, CashOutSchema } from './operations.dto';
import { presentTransaction } from './presenter';
import { TransactionsService } from './transactions.service';

@Controller('agent/v1')
@UseGuards(AgentAuthGuard)
export class OperationsController {
  constructor(
    private readonly cashOut: CashOutService,
    private readonly cashIn: CashInService,
    private readonly transactions: TransactionsService,
    private readonly idempotency: IdempotencyService,
    private readonly stepUp: StepUpService
  ) {}

  @Post('cash-out/resolve')
  async resolve(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = CashOutResolveSchema.parse(body);
    reply.status(200);
    return this.cashOut.resolve(agent, input.code);
  }

  @Post('cash-out')
  @UseGuards(DeviceSignatureGuard)
  async executeCashOut(
    @CurrentAgent() agent: AgentContext,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const input = CashOutSchema.parse(body);
    const result = await this.idempotency.run(agent.agentId, key, 'POST /cash-out', input, async () => {
      await this.stepUp.verify(agent, input.agent_auth, req);
      const tx = await this.cashOut.execute(agent, input, key!);
      return { status: tx.status === 'completed' ? 201 : 202, body: { transaction: presentTransaction(tx, agent.agentCode) } };
    });
    if (result.replayed) reply.header('Idempotent-Replayed', 'true');
    reply.status(result.status);
    return result.body;
  }

  @Post('cash-in')
  @UseGuards(DeviceSignatureGuard)
  async createCashIn(
    @CurrentAgent() agent: AgentContext,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const input = CashInSchema.parse(body);
    const result = await this.idempotency.run(agent.agentId, key, 'POST /cash-in', input, async () => {
      await this.stepUp.verify(agent, input.agent_auth, req);
      const tx = await this.cashIn.create(agent, input, key!);
      return { status: 201, body: { transaction: presentTransaction(tx, agent.agentCode) } };
    });
    if (result.replayed) reply.header('Idempotent-Replayed', 'true');
    reply.status(result.status);
    return result.body;
  }

  @Post('transactions/:id/cancel')
  async cancel(@CurrentAgent() agent: AgentContext, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const tx = await this.cashIn.cancel(agent, id);
    reply.status(200);
    return { transaction: presentTransaction(tx, agent.agentCode) };
  }

  @Get('transactions')
  list(@CurrentAgent() agent: AgentContext, @Query() query: unknown) {
    return this.transactions.list(agent, query);
  }

  @Get('transactions/by-key/:key')
  byKey(@CurrentAgent() agent: AgentContext, @Param('key') key: string) {
    return this.transactions.getByKey(agent, key);
  }

  @Get('transactions/:id')
  get(@CurrentAgent() agent: AgentContext, @Param('id') id: string) {
    return this.transactions.get(agent, id);
  }
}
