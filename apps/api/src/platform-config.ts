// SPDX-License-Identifier: AGPL-3.0-only
import { text, UUID } from './security';
export interface PlatformConfig {
  databaseUrl: string; dataKey: string; sessionSecret: string; privateKey: string; origin: string;
  tenantId: string; ownerEmail?: string; ownerPassword?: string;
  initialServerId?: string; initialAgentHash?: string; webDist?: string; demo?: boolean;
}
export function platformConfiguration(env: NodeJS.ProcessEnv): PlatformConfig {
  const databaseUrl = text(env.DATABASE_URL, 2048), dataKey = text(env.VOS_DATA_KEY, 128),
    sessionSecret = text(env.VOS_SESSION_SECRET, 256, 32), privateKey = text(env.VOS_CONTROL_PRIVATE_KEY, 512);
  const origin = new URL(text(env.APP_ORIGIN, 256));
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))) throw new Error('APP_ORIGIN requires HTTPS or loopback');
  if (!UUID.test(env.VOS_TENANT_ID ?? '')) throw new Error('Invalid tenant');
  if (env.VOS_AGENT_SERVER_ID && (!UUID.test(env.VOS_AGENT_SERVER_ID) || !/^[a-f0-9]{64}$/.test(env.VOS_AGENT_TOKEN_SHA256 ?? ''))) throw new Error('Invalid initial agent');
  return { databaseUrl, dataKey, sessionSecret, privateKey, origin: origin.origin, tenantId: env.VOS_TENANT_ID!,
    ownerEmail: env.VOS_ADMIN_EMAIL, ownerPassword: env.VOS_ADMIN_PASSWORD, initialServerId: env.VOS_AGENT_SERVER_ID,
    initialAgentHash: env.VOS_AGENT_TOKEN_SHA256, webDist: env.VOS_WEB_DIST, demo: env.VOS_DEMO === '1' };
}
