import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AgentContext {
  agentId: string;
  agentCode: string;
  status: string;
  tierCode: string | null;
  sessionId: string;
  deviceId: string;
  deviceCooldownUntil: Date | null;
}

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    agent?: AgentContext;
    rawBody?: Buffer;
  }
}

export const CurrentAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): AgentContext => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.agent) throw new Error('CurrentAgent used on a route without AgentAuthGuard');
  return req.agent;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua : null, requestId: String(req.id) };
});

export function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
