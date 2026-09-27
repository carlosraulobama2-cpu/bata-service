import { DynamicModule, Inject, Injectable, Module, OnApplicationShutdown, Provider } from '@nestjs/common';
import { ENV, Env } from './config/env';
import { AuditService } from './common/audit/audit.service';
import { AgentAuthGuard } from './common/auth/agent-auth.guard';
import { DeviceSignatureGuard } from './common/auth/device-signature.guard';
import { JwtService } from './common/auth/jwt';
import { PinHasher } from './common/crypto/secrets';
import { AGENT_DB, AgentDb, createAgentDb } from './common/db/database';
import { IdempotencyService } from './common/idempotency/idempotency.service';
import { JobsService } from './common/jobs.service';
import { Clock, SystemClock } from './common/time/clock';
import { CoreClient } from './integrations/core/core.client';
import { FakeCoreClient } from './integrations/core/fake-core.client';
import { LedgerClient } from './integrations/ledger/ledger.client';
import { LocalLedgerClient } from './integrations/ledger/local-ledger.client';
import { InMemorySmsSender, SmsSender } from './integrations/sms/sms.sender';
import { AgentController } from './modules/agent/agent.controller';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CredentialsService } from './modules/auth/credentials.service';
import { SessionsService } from './modules/auth/sessions.service';
import { StepUpService } from './modules/auth/step-up.service';
import { DevController } from './modules/dev/dev.controller';
import { CoreEventsController } from './modules/internal/core-events.controller';
import { CashInService } from './modules/operations/cash-in.service';
import { CashOutService } from './modules/operations/cash-out.service';
import { CommissionsService } from './modules/operations/commissions.service';
import { LimitsService } from './modules/operations/limits.service';
import { OperationLifecycleService } from './modules/operations/operation-lifecycle.service';
import { OperationsController } from './modules/operations/operations.controller';
import { ReconcilerService } from './modules/operations/reconciler.service';
import { TransactionsService } from './modules/operations/transactions.service';
import { QrCodec } from './modules/qr/qr-codec';
import { QrController } from './modules/qr/qr.controller';
import { QrService } from './modules/qr/qr.service';

@Injectable()
class ResourcesLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly ledger: LedgerClient
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.db.destroy(), this.ledger.close()]);
  }
}

export interface AppOverrides {
  clock?: Clock;
  sms?: SmsSender;
  /** Tests only: wrap the ledger client (fault injection). */
  wrapLedger?: (ledger: LedgerClient) => LedgerClient;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: ENV, useValue: env },
      { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
      { provide: AGENT_DB, useFactory: () => createAgentDb(env.DATABASE_URL) },
      {
        provide: LedgerClient,
        useFactory: () => {
          const ledger = new LocalLedgerClient(env.LEDGER_DATABASE_URL);
          return overrides.wrapLedger ? overrides.wrapLedger(ledger) : ledger;
        }
      },
      { provide: CoreClient, useFactory: (ledger: LedgerClient, clock: Clock) => new FakeCoreClient(ledger, clock), inject: [LedgerClient, Clock] },
      { provide: SmsSender, useValue: overrides.sms ?? new InMemorySmsSender() },
      { provide: PinHasher, useValue: new PinHasher(env.PIN_PEPPER) },
      { provide: QrCodec, useValue: new QrCodec(env.QR_SIGNING_PRIVATE_KEY_PEM) },
      { provide: JwtService, useValue: new JwtService(env.JWT_PRIVATE_KEY_PEM, env.JWT_ISSUER, env.JWT_AUDIENCE, env.ACCESS_TOKEN_TTL_SECONDS) },
      ResourcesLifecycle,
      AuditService,
      IdempotencyService,
      AgentAuthGuard,
      DeviceSignatureGuard,
      CredentialsService,
      SessionsService,
      AuthService,
      StepUpService,
      LimitsService,
      CommissionsService,
      OperationLifecycleService,
      CashOutService,
      CashInService,
      TransactionsService,
      QrService,
      ReconcilerService,
      JobsService
    ];
    const controllers: DynamicModule['controllers'] = [AuthController, AgentController, OperationsController, QrController, CoreEventsController];
    if (env.ENABLE_DEV_ENDPOINTS && env.NODE_ENV !== 'production') controllers.push(DevController);
    return { module: AppModule, providers, controllers };
  }
}
