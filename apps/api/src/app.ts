// SPDX-License-Identifier: AGPL-3.0-only
import 'reflect-metadata';
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, Headers, HttpCode, HttpException, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AgentConfig { serverId: string; tenantId: string; tokenSha256: string }
export function configuration(env: NodeJS.ProcessEnv): AgentConfig {
  const serverId = env.VOS_AGENT_SERVER_ID ?? '';
  const tenantId = env.VOS_TENANT_ID ?? '';
  const tokenSha256 = env.VOS_AGENT_TOKEN_SHA256 ?? '';
  if (!uuid.test(serverId) || !uuid.test(tenantId) || !/^[a-f0-9]{64}$/.test(tokenSha256)) {
    throw new Error('Configure VOS_AGENT_SERVER_ID, VOS_TENANT_ID e VOS_AGENT_TOKEN_SHA256.');
  }
  return { serverId, tenantId, tokenSha256 };
}

interface Heartbeat {
  schemaVersion: 1; messageId: string; serverId: string; sentAt: string; occurredAt: string;
  type: 'server.heartbeat'; source: 'paper-api';
  payload: { pluginVersion: string; minecraftVersion: string; paperVersion: string; authMeVersion: string;
    uptimeSeconds: number; playersOnline: number };
}
function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function createApplication(config: AgentConfig, clock = Date.now) {
  // Shared contract, no duplicate handwritten validation rules.
  const schema = JSON.parse(readFileSync(resolve(__dirname,
    '../../../packages/api-contracts/heartbeat.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: true, allErrors: false });
  addFormats(ajv);
  const validate = ajv.compile<Heartbeat>(schema);
  const expectedToken = Buffer.from(config.tokenSha256, 'hex');
  const recent = new Map<string, { fingerprint: string; receivedAt: string; time: number }>();
  let latest: { tenantId: string; heartbeat: Heartbeat; receivedAt: string } | undefined;
  let rateStart = clock(), requests = 0, agentStart = clock(), agentRequests = 0;

  @Controller('api/v1')
  class HeartbeatController {
    @Get('health') health() { return { status: 'ok' }; }

    @Post('agents/heartbeat')
    @HttpCode(202)
    heartbeat(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
      const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization ?? '')?.[1];
      const digest = createHash('sha256').update(token ?? '').digest();
      if (!token || !timingSafeEqual(digest, expectedToken)) {
        throw new HttpException('Unauthorized', 401);
      }
      const now = clock();
      if (now - agentStart >= 60_000) { agentStart = now; agentRequests = 0; }
      if (++agentRequests > 30) throw new HttpException('Rate limited', 429);
      if (!validate(body)) throw new HttpException('Invalid heartbeat', 400);
      if (body.serverId !== config.serverId) throw new HttpException('Forbidden', 403);
      const sent = Date.parse(body.sentAt), occurred = Date.parse(body.occurredAt);
      if (Math.abs(now - sent) > 120_000 || Math.abs(now - occurred) > 120_000
          || occurred > sent + 5_000) throw new HttpException('Expired heartbeat', 400);
      // Strict validation rejects tenantId and any credentials in the body.
      for (const [id, entry] of recent) if (now - entry.time > 300_000) recent.delete(id);
      const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
      const previous = recent.get(body.messageId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpException('Conflicting message', 409);
        return { messageId: body.messageId, receivedAt: previous.receivedAt, duplicate: true };
      }
      const receivedAt = new Date(now).toISOString();
      if (recent.size >= 1024) recent.delete(recent.keys().next().value!);
      recent.set(body.messageId, { fingerprint, receivedAt, time: now });
      // Late retries never overwrite the latest observation.
      if (!latest || Date.parse(body.occurredAt) >= Date.parse(latest.heartbeat.occurredAt)) {
        latest = { tenantId: config.tenantId, heartbeat: structuredClone(body), receivedAt };
      }
      return { messageId: body.messageId, receivedAt, duplicate: false };
    }
  }
  @Module({ controllers: [HeartbeatController] })
  class AppModule {}

  const app = await NestFactory.create<NestExpressApplication>(AppModule,
    { logger: false, bodyParser: false });
  @Catch()
  class SanitizedErrors implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) {
      const code = error instanceof HttpException ? error.getStatus()
        : typeof (error as any)?.status === 'number' ? (error as any).status : 500;
      const status = [400, 401, 403, 404, 409, 413, 415, 429].includes(code) ? code : 500;
      host.switchToHttp().getResponse().status(status).json({ statusCode: status,
        message: status === 500 ? 'Internal error' : 'Request rejected' });
    }
  }
  app.useGlobalFilters(new SanitizedErrors());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: unknown, res: any, next: () => void) => {
    const now = clock();
    if (now - rateStart >= 60_000) { rateStart = now; requests = 0; }
    res.setHeader('Cache-Control', 'no-store');
    if (++requests > 600) return res.status(429).json({ message: 'Rate limited' });
    next();
  });
  app.use(json({ limit: '8kb', strict: true, inflate: false }));
  const server = app.getHttpServer();
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 64;
  return { app, snapshot: () => latest && structuredClone(latest) };
}
