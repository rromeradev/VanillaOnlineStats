// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpException } from '@nestjs/common';

const scrypt = promisify(scryptCallback);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export function fail(code: number, message = 'Request rejected'): never { throw new HttpException(message, code); }
export function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b-\u001f]/.test(value)) fail(400);
  return value;
}
export function id(value: unknown): string { const result = text(value, 36); if (!UUID.test(result)) fail(400); return result; }
export function fields(body: any, allowed: string[]): void {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(400);
}
export async function passwordHash(password: string): Promise<string> {
  text(password, 128, 12); const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const result = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(result, Buffer.from(expected, 'hex'));
}
export function csrf(token: string, key: string): string { return createHmac('sha256', key).update(token).digest('hex'); }
export function same(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export class Vault {
  private key: Buffer;
  constructor(encoded: string) { this.key = Buffer.from(encoded, 'base64'); if (this.key.length !== 32) throw new Error('Invalid VOS_DATA_KEY'); }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  open(value: string, context: string): any {
    const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export class Limits {
  private windows = new Map<string, { until: number; count: number }>();
  check(key: string, max: number, millis = 60_000): void {
    const now = Date.now();
    if (this.windows.size > 4096) for (const [id, value] of this.windows) if (value.until < now) this.windows.delete(id);
    let value = this.windows.get(key);
    if (!value || value.until < now) {
      if (this.windows.size >= 8192) fail(429);
      value = { until: now + millis, count: 0 }; this.windows.set(key, value);
    }
    if (++value.count > max) fail(429);
  }
}
