import { Controller, Get, Inject } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { RateLimit } from '../../common/rate-limit/rate-limit.policies';

/**
 * Configuration the app needs BEFORE signing in: how to reach support
 * (an agent whose account is locked can't open anything else) and the
 * minimum app version. Nothing private here.
 */
@Controller('agent/v1/public')
@RateLimit('none')
export class PublicController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('config')
  config() {
    return {
      support: {
        phone: this.env.SUPPORT_PHONE || null,
        whatsapp: this.env.SUPPORT_WHATSAPP || null,
        hours: this.env.SUPPORT_HOURS || null
      },
      min_app_version: this.env.MIN_APP_VERSION
    };
  }
}
