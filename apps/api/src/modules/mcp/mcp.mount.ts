import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { attachSecurityHeadersToRawRoutes } from '../../common/security-headers.middleware';
import type { NextFunction, Request, Response } from 'express';
import { McpBridgeAuth } from './mcp-bridge-auth';
import type { McpActor } from './mcp.context';
import type { McpOAuthVerifier } from './mcp-oauth-verifier';
import { McpRateLimiter } from './mcp-rate-limit';
import { createGiaoKhoaMcpServer } from './mcp.server';
import type { McpToolDeps } from './mcp.tools';
import { tenantAls } from '../tenants/tenant-als';


const logger = new Logger('McpMount');

const MAX_BODY_BYTES = 256 * 1024;
const MCP_SCOPES = ['giaokhoa.questions.read', 'giaokhoa.questions.draft', 'giaokhoa.questions.write', 'giaokhoa.banks.contribute'] as const;

const BRIDGE_SCOPES: readonly string[] = ['giaokhoa.questions.read', 'giaokhoa.questions.draft', 'giaokhoa.banks.contribute'];

const TOOL_REQUIRED_SCOPES: Record<string, string> = {
  list_my_banks: 'giaokhoa.questions.read',
  list_categories: 'giaokhoa.questions.read',
  get_question: 'giaokhoa.questions.read',
  search_questions: 'giaokhoa.questions.read',
  check_duplicates: 'giaokhoa.questions.read',
  search_curriculum_outcomes: 'giaokhoa.questions.read',
  create_question: 'giaokhoa.questions.draft',
  create_questions_batch: 'giaokhoa.questions.draft',
  create_stimulus_with_questions: 'giaokhoa.questions.draft',
  publish_questions: 'giaokhoa.questions.write',
  submit_contribution: 'giaokhoa.banks.contribute',
};

interface JsonRpcEnvelope {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: {
    name?: unknown;
    arguments?: unknown;
    _meta?: Record<string, unknown>;
    clientInfo?: { name?: unknown };
  } & Record<string, unknown>;
}

function jsonRpcError(res: Response, status: number, id: unknown, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function clientIdOf(body: JsonRpcEnvelope): string {
  const meta = body.params?._meta?.['io.modelcontextprotocol/clientInfo'] as { name?: unknown } | undefined;
  const raw = meta?.name ?? body.params?.clientInfo?.name;
  if (typeof raw !== 'string' || raw.length === 0) return 'unknown';
  const cleaned = raw.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'unknown';
}

function readRawBody(req: Request): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

export interface McpMountDeps {
  bridgeAuth: McpBridgeAuth;
  rateLimiter: McpRateLimiter;
  publicBaseUrl: string | null;
  issuer: string | null;
  oauthVerifier?: McpOAuthVerifier | null;
  resolveActor?: (userId: string) => Promise<{ username: string; tenantId?: string | null } | null>;
  grantedScopes?: readonly string[];
  toolDeps: McpToolDeps;
}

export function mountMcp(app: NestExpressApplication, deps: McpMountDeps): void {
  const server = app.getHttpAdapter().getInstance() as {
    use: import('express').Express['use'];
    all: (path: string, handler: (req: Request, res: Response, next: NextFunction) => void) => void;
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  attachSecurityHeadersToRawRoutes(server, [
    '/mcp',
    '/.well-known/oauth-protected-resource',
  ]);

  const handler: McpHttpHandler = createMcpHandler(
    (ctx) => {
      const extra = (ctx.authInfo?.extra ?? {}) as { userId?: string; username?: string; ip?: string | null; tenantId?: string | null };
      const actor: McpActor = {
        userId: extra.userId ?? '',
        username: extra.username ?? '',
        tenantId: extra.tenantId ?? null,
        clientId: ctx.authInfo?.clientId ?? 'unknown',
        ip: extra.ip ?? null,
        era: ctx.era,
        scopes: ctx.authInfo?.scopes ?? [],
      };
      return createGiaoKhoaMcpServer(actor, deps.toolDeps);
    },
    {
      legacy: 'stateless',
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => {
        logger.error(`[mcp] handler error: ${error.message}`);
      },
    },
  );

  const baseOf = (req: Request): string =>
    deps.publicBaseUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;

  const prm = (req: Request): Record<string, unknown> => {
    const base = baseOf(req);
    return {
      resource: `${base}/mcp`,
      authorization_servers: [deps.issuer ?? base],
      bearer_methods_supported: ['header'],
      scopes_supported: [...MCP_SCOPES],
    };
  };
  server.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json(prm(req));
  });
  server.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
    res.json(prm(req));
  });

  server.all('/mcp', (req: Request, res: Response, _next: NextFunction) => {
    void (async () => {
      if (req.method !== 'POST') {
        const webRes = await handler.fetch(toWebRequest(req, null), {});
        return pipeWebResponse(webRes, res);
      }
      const raw = await readRawBody(req);
      if (raw === null) {
        return jsonRpcError(res, 413, null, -32000, 'Request body too large (limit 256 KB)');
      }
      let body: JsonRpcEnvelope;
      try {
        body = JSON.parse(raw.toString('utf8')) as JsonRpcEnvelope;
      } catch {
        return jsonRpcError(res, 400, null, -32700, 'Parse error: request body is not valid JSON');
      }
      if (typeof body !== 'object' || body === null || typeof body.method !== 'string') {
        return jsonRpcError(res, 400, null, -32600, 'Invalid Request: missing JSON-RPC method');
      }
      const headerMethod = req.get('mcp-method');
      if (headerMethod !== undefined && headerMethod !== body.method) {
        return jsonRpcError(res, 400, body.id, -32020, 'HeaderMismatchError: Mcp-Method header does not match the request method');
      }
      if (body.method === 'tools/call') {
        const headerName = req.get('mcp-name');
        const toolName = typeof body.params?.name === 'string' ? body.params.name : undefined;
        if (headerName !== undefined && toolName !== undefined && headerName !== toolName) {
          return jsonRpcError(res, 400, body.id, -32020, 'HeaderMismatchError: Mcp-Name header does not match the tool name');
        }
      }
      let identity: { userId: string; username: string; tenantId: string | null };
      let tokenScopes: readonly string[];
      let verifiedClientId: string | null = null;
      if (deps.oauthVerifier) {
        const verdict = await deps.oauthVerifier.verify(toWebRequest(req, raw));
        if (!verdict.ok) {
          res.setHeader(
            'WWW-Authenticate',
            verdict.wwwAuthenticate ??
              `Bearer resource_metadata="${baseOf(req)}/.well-known/oauth-protected-resource", error="invalid_token"`,
          );
          const forbidden = verdict.status === 403;
          return jsonRpcError(
            res,
            forbidden ? 403 : 401,
            body.id,
            forbidden ? -32003 : -32001,
            forbidden
              ? 'Insufficient scope: the access token does not carry the required scope'
              : 'Unauthorized: a valid GiaoKhoa access token is required',
          );
        }
        const actor = deps.resolveActor ? await deps.resolveActor(verdict.identity.userId) : null;
        if (!actor || verdict.identity.userId.length === 0) {
          res.setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${baseOf(req)}/.well-known/oauth-protected-resource", error="invalid_token"`,
          );
          return jsonRpcError(res, 401, body.id, -32001, 'Unauthorized: the token subject is not an active GiaoKhoa user');
        }
        identity = {
          userId: verdict.identity.userId,
          username: actor.username,
          tenantId: verdict.identity.tenantId ?? actor.tenantId ?? null,
        };
        tokenScopes = verdict.identity.scopes;
        verifiedClientId = verdict.identity.clientId;
      } else {
        const bridgeIdentity = await deps.bridgeAuth.authenticate(req.get('authorization'));
        if (!bridgeIdentity) {
          res.setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${baseOf(req)}/.well-known/oauth-protected-resource", error="invalid_token"`,
          );
          return jsonRpcError(res, 401, body.id, -32001, 'Unauthorized: a valid GiaoKhoa access token is required');
        }
        identity = bridgeIdentity;
        tokenScopes = BRIDGE_SCOPES;
      }
      const effectiveScopes = deps.grantedScopes ?? tokenScopes;
      if (body.method === 'tools/call') {
        const toolName = typeof body.params?.name === 'string' ? body.params.name : undefined;
        const requiredScope = toolName ? TOOL_REQUIRED_SCOPES[toolName] : undefined;
        if (requiredScope && !effectiveScopes.includes(requiredScope)) {
          res.setHeader(
            'WWW-Authenticate',
            `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${baseOf(req)}/.well-known/oauth-protected-resource"`,
          );
          return jsonRpcError(res, 403, body.id, -32003, `Insufficient scope: this tool requires "${requiredScope}"`);
        }
        const args = body.params?.arguments;
        const cost =
          toolName === 'create_questions_batch' &&
          typeof args === 'object' &&
          args !== null &&
          Array.isArray((args as { items?: unknown }).items)
            ? ((args as { items: unknown[] }).items.length ?? 1)
            : 1;
        const decision = deps.rateLimiter.check(identity.userId, McpRateLimiter.bucketForTool(toolName), Date.now(), cost);
        if (!decision.allowed) {
          res.setHeader('Retry-After', String(decision.retryAfterSeconds));
          return jsonRpcError(res, 429, body.id, -32029, 'Rate limit exceeded for this tool; retry later');
        }
      }
      const authInfo: AuthInfo = {
        token: (req.get('authorization') ?? '').slice('Bearer '.length),
        clientId: verifiedClientId ?? clientIdOf(body),
        scopes: [...effectiveScopes],
        extra: { userId: identity.userId, username: identity.username, ip: req.ip ?? null, tenantId: identity.tenantId },
      };
      const webRes = await tenantAls.run(
        { tenantId: identity.tenantId ?? undefined, userId: identity.userId },
        () => handler.fetch(toWebRequest(req, raw), { authInfo }),
      );
      return pipeWebResponse(webRes, res);
    })().catch((err: unknown) => {
      logger.error(`[mcp] mount error: ${err instanceof Error ? (err.stack ?? String(err)) : String(err)}`);
      if (!res.headersSent) jsonRpcError(res, 500, null, -32603, 'Internal error');
    });
  });
}

function toWebRequest(req: Request, rawBody: Buffer | null): globalThis.Request {
  const protocol = req.protocol ?? 'http';
  const host = req.get('host') ?? 'localhost';
  const url = `${protocol}://${host}${req.originalUrl ?? req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  if (req.method === 'POST' && rawBody !== null) {
    return new globalThis.Request(url, { method: 'POST', headers, body: new Uint8Array(rawBody) });
  }
  return new globalThis.Request(url, { method: req.method, headers });
}

async function pipeWebResponse(webRes: globalThis.Response, res: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') return;
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}
