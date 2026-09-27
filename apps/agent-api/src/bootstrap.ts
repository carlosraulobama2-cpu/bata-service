import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Env } from './config/env';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { AppModule, AppOverrides } from './app.module';

export async function createApp(env: Env, overrides: AppOverrides = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 64 * 1024,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
    }
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env, overrides), adapter, {
    rawBody: true, // needed to verify device and Core signatures over the exact bytes
    logger: env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error']
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length) {
    app.enableCors({
      origin: origins,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Timestamp', 'X-Device-Signature', 'X-Device-Id', 'X-App-Version', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
      methods: ['GET', 'POST', 'DELETE']
    });
  }
  app.enableShutdownHooks();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });
  fastify.get('/health', async () => ({ status: 'ok' }));
  await app.init();
  return app;
}
