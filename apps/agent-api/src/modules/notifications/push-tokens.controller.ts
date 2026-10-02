import { Body, Controller, Delete, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';

// Expo tokens ("ExponentPushToken[...]") or raw FCM/APNs tokens.
const TokenSchema = z.object({ token: z.string().min(20).max(300).regex(/^[A-Za-z0-9_:\-\[\].]+$/) });

/** The app registers the push token of THIS device (docs/05-api.md §13). */
@Controller('agent/v1/push-tokens')
@UseGuards(AgentAuthGuard)
export class PushTokensController {
  constructor(@Inject(AGENT_DB) private readonly db: AgentDb) {}

  @Post()
  @HttpCode(200)
  async register(@CurrentAgent() agent: AgentContext, @Body() body: unknown) {
    const { token } = TokenSchema.parse(body);
    await this.db.transaction().execute(async (trx) => {
      // A token identifies a phone installation: if another device row had it (reinstall,
      // another agent on a shared phone), it stops receiving this phone's pushes.
      await trx.updateTable('agent.agent_devices').set({ push_token: null }).where('push_token', '=', token).where('id', '<>', agent.deviceId).execute();
      await trx.updateTable('agent.agent_devices').set({ push_token: token }).where('id', '=', agent.deviceId).execute();
    });
    return { registered: true };
  }

  @Delete()
  @HttpCode(200)
  async unregister(@CurrentAgent() agent: AgentContext) {
    await this.db.updateTable('agent.agent_devices').set({ push_token: null }).where('id', '=', agent.deviceId).execute();
    return { registered: false };
  }
}
