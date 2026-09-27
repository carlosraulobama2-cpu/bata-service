import { RateLimit } from '../../common/rate-limit/rate-limit.policies';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent, Meta, RequestMeta } from '../../common/auth/request-context';
import { AuditService } from '../../common/audit/audit.service';
import { Inject } from '@nestjs/common';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { LoginSchema, RefreshSchema, VerifyOtpSchema } from './auth.dto';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';

@Controller('agent/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    @Inject(AGENT_DB) private readonly db: AgentDb
  ) {}

  @Post('login')
  @RateLimit('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.auth.login(LoginSchema.parse(body), meta);
  }

  @Post('verify-otp')
  @RateLimit('verify_otp')
  @HttpCode(200)
  verifyOtp(@Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.auth.verifyOtp(VerifyOtpSchema.parse(body), meta);
  }

  @Post('refresh')
  @RateLimit('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.sessions.refresh(RefreshSchema.parse(body).refresh_token, meta.ip);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AgentAuthGuard)
  async logout(@CurrentAgent() agent: AgentContext, @Meta() meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(agent.sessionId, 'logout');
    // A signed-out phone (maybe lent or shared) must not keep showing this agent's operations.
    await this.db.updateTable('agent.agent_devices').set({ push_token: null }).where('id', '=', agent.deviceId).execute();
    await this.db.insertInto('agent.agent_access_events').values({ agent_id: agent.agentId, phone_hmac: null, event: 'logout', device_id: agent.deviceId, ip: meta.ip, approx_location: null }).execute();
    await this.audit.record(this.db, { actorType: 'agent', actorId: agent.agentCode, agentId: agent.agentId, action: 'LOGOUT', resourceType: 'session', resourceId: agent.sessionId, result: 'success', deviceId: agent.deviceId, ip: meta.ip, requestId: meta.requestId });
  }
}
