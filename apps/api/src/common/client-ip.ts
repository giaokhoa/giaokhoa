import { isIPv4 } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';

export const TRUSTED_PROXY_HOPS = 1;

export function enableTrustedProxy(app: Pick<NestExpressApplication, 'set'>): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}

export function normalizeIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const prefix = '::ffff:';
  if (ip.startsWith(prefix)) {
    const rest = ip.slice(prefix.length);
    if (isIPv4(rest)) return rest;
  }
  return ip;
}

export function clientIpOf(req: Pick<Request, 'ip'>): string | undefined {
  return normalizeIpAddress(req.ip);
}
