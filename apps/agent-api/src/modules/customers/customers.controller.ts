import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent, Meta, RequestMeta } from '../../common/auth/request-context';
import { CustomersService } from './customers.service';

const VerifySchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  full_name: z.string().trim().min(3).max(120)
});

@Controller('agent/v1/customers')
@UseGuards(AgentAuthGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Name + phone -> is this a verified BataPay customer? */
  @Post('verify')
  @HttpCode(200)
  verify(@CurrentAgent() agent: AgentContext, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.customers.verify(agent, VerifySchema.parse(body), meta);
  }
}
