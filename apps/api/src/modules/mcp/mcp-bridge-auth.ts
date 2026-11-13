import { createHmac, timingSafeEqual } from 'node:crypto';
import { UsersService } from '../users/users.service';

export interface BridgeIdentity {
  userId: string;
  username: string;
  sessionId: string;
  tenantId: string | null;
}

function decodeJsonPart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function verifyBridgeToken(token: string, secret: string): BridgeIdentity | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeJsonPart(headerPart);
  const payload = decodeJsonPart(payloadPart);
  if (!header || header.alg !== 'HS256' || !payload) return null;
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  const given = Buffer.from(signaturePart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
  if (payload.scope !== undefined || typeof payload.sid !== 'string' || payload.sid.length === 0) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  return {
    userId: payload.sub,
    username: typeof payload.username === 'string' ? payload.username : '',
    sessionId: payload.sid,
    tenantId: typeof payload.tid === 'string' ? payload.tid : null,
  };
}

export class McpBridgeAuth {
  constructor(
    private readonly jwtSecret: string,
    private readonly users: UsersService,
  ) {}

  async authenticate(authorization: string | undefined): Promise<BridgeIdentity | null> {
    if (!authorization?.startsWith('Bearer ')) return null;
    const identity = verifyBridgeToken(authorization.slice('Bearer '.length).trim(), this.jwtSecret);
    if (!identity) return null;
    const user = await this.users.getByIdOrUndefined(identity.userId);
    if (!user || user.deleted || user.suspended) return null;
    return { ...identity, username: user.username };
  }
}
