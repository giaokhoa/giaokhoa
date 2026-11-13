import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { attachSecurityHeadersToRawRoutes } from '../../common/security-headers.middleware';
import type { NextFunction, Request, Response } from 'express';
import { McpBridgeAuth } from './mcp-bridge-auth';
import type { McpActor } from './mcp.context';
import type { McpOAuthVerifier } from './mcp-oauth-verifier';
import { McpRateLimiter } from './mcp-rate-limit';
import { MCP_TOOL_REGISTRY } from './mcp-tool-registry';
import { createGiaoKhoaMcpServer } from './mcp.server';
import type { McpToolDeps } from './mcp.tools';
import { tenantAls } from '../tenants/tenant-als';

/**
 * Mount MCP server của Giáo khoa (MCP-0, issue #110) lên express instance của Nest — cùng tiền lệ Better Auth (better-auth.mount.ts): đăng ký TRƯỚC route + body parser của Nest để request tới /mcp đến tay handler ở dạng thô. MCP có không gian URL riêng, KHÔNG nằm dưới /api/v1:
 *
 *   POST /mcp — endpoint Streamable HTTP duy nhất, một endpoint hai kỷ nguyên (modern 2026-07-28 stateless + legacy 2025-11-25) qua createMcpHandler của SDK v2 (`legacy: 'stateless'`). GET /.well-known/oauth-protected-resource[/mcp] — Protected Resource Metadata (RFC 9728) trỏ tới issuer cấu hình (MCP_AUTH_ISSUER; mặc định = chính origin này — AS đầy đủ là lát MCP-1).
 *
 * Lớp vận chuyển (validate lớp 0, hồ sơ research Phần 3.1) do mount chịu trước khi request chạm handler: body ≤ 256 KB, JSON parse được, header Mcp-Method/Mcp-Name (client modern gửi) phải khớp method/tên tool trong body (lệch → lỗi -32020 HeaderMismatchError), token cầu auth hợp lệ mới tới được bất kỳ tool nào (401 + WWW-Authenticate trỏ PRM), tool có scope riêng mà trần scope không có → 403 `insufficient_scope` + challenge step-up (lát MCP-2), rate limit theo
 * (giáo viên, nhóm tool) vượt hạn → 429.
 */

/**
 * Logger của mount (code ngoài class nên khai cấp module với context dạng chuỗi, cùng tiền lệ `new Logger('Worker')` ở apps/worker): mọi lỗi vận hành của handler và của vòng mount đều ghi qua đây ở mức error, không gọi thẳng console như trước.
 */
const logger = new Logger('McpMount');

const MAX_BODY_BYTES = 256 * 1024;
/** Mã lỗi JSON-RPC dùng ở mount (đặc tả JSON-RPC + Streamable HTTP): -32000 lỗi server do mount, -32700 parse, -32600 request không hợp lệ, -32020 header lệch, -32001 chưa xác thực, -32003 thiếu scope, -32029 rate limit, -32603 lỗi nội bộ. */
const JSON_RPC = {
  SERVER_ERROR: -32000,
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  HEADER_MISMATCH: -32020,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  RATE_LIMITED: -32029,
  INTERNAL_ERROR: -32603,
} as const;
/** Độ dài tối đa của client_id tự giới thiệu (chỉ để truy vết) trước khi cắt ngắn. */
const MAX_CLIENT_ID_LENGTH = 64;
/**
 * Toàn bộ scope mà PRM quảng bá — suy từ đăng ký tool duy nhất
 * (`MCP_TOOL_REGISTRY`), thứ tự xuất hiện đầu tiên: read, draft,
 * write, contribute. Thêm scope mới cho tool thì thêm vào registry.
 */
const MCP_SCOPES: readonly string[] = [...new Set(Object.values(MCP_TOOL_REGISTRY).map((entry) => entry.scope))];

/**
 * Tập scope kỷ nguyên CẦU AUTH cấp cho token hệ thống (authInfo.scopes):
 * chỉ các scope đã có tool thật sau lưng — read + draft của MCP-0 và contribute của lát MCP-2 (issue #110 mở lại). `giaokhoa.questions.write` KHÔNG nằm ở đây: publish là tool của MCP-1 và chỉ gọi được bằng access token OAuth thật (cầu auth cấp trần đồng nhất không dựng được ca thiếu scope — chính là động cơ của lát này). Khi AS bật, scope lấy từ access token qua McpOAuthVerifier; `deps.grantedScopes` vẫn là đường ghi đè cho test ở cả hai kỷ nguyên.
 */
const BRIDGE_SCOPES: readonly string[] = ['giaokhoa.questions.read', 'giaokhoa.questions.draft', 'giaokhoa.banks.contribute'];

/**
 * Scope riêng của TỪNG tool (lát MCP-1 hoàn thiện bản đồ của MCP-0):
 * thiếu scope → 403 `insufficient_scope` + challenge step-up (research Phần 2.2). Suy từ đăng ký tool duy nhất (`MCP_TOOL_REGISTRY`) — không liệt kê tay ở đây nữa để thêm tool không phải sửa 3 nơi. Scope chỉ là TRẦN của token — quyền nghiệp vụ thật vẫn do capability tại context của bank quyết ở tầng tool như REST.
 */
const TOOL_REQUIRED_SCOPES: Record<string, string> = Object.fromEntries(
  Object.entries(MCP_TOOL_REGISTRY).map(([tool, entry]) => [tool, entry.scope]),
);

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

/** client_id từ clientInfo client tự giới thiệu (chỉ để truy vết — không tin cậy, xem research 3.3). */
function clientIdOf(body: JsonRpcEnvelope): string {
  const meta = body.params?._meta?.['io.modelcontextprotocol/clientInfo'] as { name?: unknown } | undefined;
  const raw = meta?.name ?? body.params?.clientInfo?.name;
  if (typeof raw !== 'string' || raw.length === 0) return 'unknown';
  const cleaned = raw.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, MAX_CLIENT_ID_LENGTH);
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
  /** Origin công khai của chính API (PRM `resource` + authorization_servers mặc định). */
  publicBaseUrl: string | null;
  issuer: string | null;
  /**
   * Bộ kiểm access token OAuth của AS (lát MCP-1). Có giá trị → mount đi đường RS THẬT: token được kiểm chữ ký JWKS + iss/aud bởi verifier của plugin và scope lấy từ chính token; cầu bridge KHÔNG được dùng nữa. Null/thiếu → đường lùi cầu auth của MCP-0 như cũ.
   */
  oauthVerifier?: McpOAuthVerifier | null;
  /**
   * Phân giải `sub` của access token thành actor còn hiệu lực (chỉ dùng ở đường OAuth): null = tài khoản đã xoá/treo → 401, cùng nghĩa với kiểm tra tài khoản trong cầu bridge. `tenantId` là tenant mặc định của user theo membership (TENANT-1, #196) — nguồn tenant của phiên khi token AS không mang claim `tid`.
   */
  resolveActor?: (userId: string) => Promise<{ username: string; tenantId?: string | null } | null>;
  /**
   * Trần scope hiệu lực cho mọi request qua mount này. Mặc định (khi không truyền) = BRIDGE_SCOPES của kỷ nguyên cầu auth; AS OAuth sẽ truyền scope của từng token. Test dùng trường này để dựng phiên thiếu scope.
   */
  grantedScopes?: readonly string[];
  /** Deps của tools (services dùng chung với REST — không có đường nghiệp vụ riêng cho MCP). */
  toolDeps: McpToolDeps;
}

export function mountMcp(app: NestExpressApplication, deps: McpMountDeps): void {
  const server = app.getHttpAdapter().getInstance() as {
    use: import('express').Express['use'];
    all: (path: string, handler: (req: Request, res: Response, next: NextFunction) => void) => void;
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  // Cả /mcp và PRM nằm ngoài chuỗi middleware/guard của Nest;
  // giữ header bảo mật trên response 200 lẫn 401/403/429 do SDK trả.
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
        // Chỉ ghi nhận phía server; response cho client do handler quyết.
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
    void handleMcpRequest(req, res, deps, handler, baseOf).catch((err: unknown) => {
      logger.error(`[mcp] mount error: ${err instanceof Error ? (err.stack ?? String(err)) : String(err)}`);
      if (!res.headersSent) jsonRpcError(res, 500, null, JSON_RPC.INTERNAL_ERROR, 'Internal error');
    });
  });
}
}

type McpAuthResult =
  | { ok: true; identity: { userId: string; username: string; tenantId: string | null }; tokenScopes: readonly string[]; verifiedClientId: string | null }
  | { ok: false; status: 401 | 403; message: string; wwwAuthenticate: string };

/** Challenge WWW-Authenticate mặc định cho token không hợp lệ (trỏ PRM của mount này). */
function invalidTokenChallenge(base: string): string {
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="invalid_token"`;
}

/**
 * Lớp 0 — header Mcp-Method/Mcp-Name (bắt buộc ở kỷ nguyên 2026-07-28)
 * khi client gửi thì PHẢI khớp body; lệch là HeaderMismatchError -32020
 * theo đặc tả Streamable HTTP. Trả null khi khớp.
 */
function validateRpcHeaders(req: Request, body: JsonRpcEnvelope): { code: number; message: string } | null {
  const headerMethod = req.get('mcp-method');
  if (headerMethod !== undefined && headerMethod !== body.method) {
    return { code: JSON_RPC.HEADER_MISMATCH, message: 'HeaderMismatchError: Mcp-Method header does not match the request method' };
  }
  if (body.method === 'tools/call') {
    const headerName = req.get('mcp-name');
    const toolName = typeof body.params?.name === 'string' ? body.params.name : undefined;
    if (headerName !== undefined && toolName !== undefined && headerName !== toolName) {
      return { code: JSON_RPC.HEADER_MISMATCH, message: 'HeaderMismatchError: Mcp-Name header does not match the tool name' };
    }
  }
  return null;
}

/**
 * Xác thực token trước khi bất kỳ tool nào chạy (research 3.1 lớp 0).
 * Hai đường, chọn theo deps (lát MCP-1):
 * - AS bật (deps.oauthVerifier): RS thật — verifier của plugin kiểm chữ
 *   ký JWKS + iss/aud + hạn; scope + client_id lấy từ CHÍNH token; tài
 *   khoản phải còn hoạt động qua resolveActor (cùng nghĩa kiểm tra trong
 *   cầu bridge).
 * - AS tắt: đường lùi cầu auth MCP-0 (token JWT hệ thống HS256, trần
 *   scope = BRIDGE_SCOPES) — giữ nguyên hành vi MCP-0.
 */
async function authenticateMcpRequest(req: Request, raw: Buffer, deps: McpMountDeps, base: string): Promise<McpAuthResult> {
  if (deps.oauthVerifier) {
    const verdict = await deps.oauthVerifier.verify(toWebRequest(req, raw));
    if (!verdict.ok) {
      const forbidden = verdict.status === 403;
      return {
        ok: false,
        status: forbidden ? 403 : 401,
        message: forbidden
          ? 'Insufficient scope: the access token does not carry the required scope'
          : 'Unauthorized: a valid GiaoKhoa access token is required',
        wwwAuthenticate: verdict.wwwAuthenticate ?? invalidTokenChallenge(base),
      };
    }
    const actor = deps.resolveActor ? await deps.resolveActor(verdict.identity.userId) : null;
    if (!actor || verdict.identity.userId.length === 0) {
      return {
        ok: false,
        status: 401,
        message: 'Unauthorized: the token subject is not an active GiaoKhoa user',
        wwwAuthenticate: invalidTokenChallenge(base),
      };
    }
    return {
      ok: true,
      identity: {
        userId: verdict.identity.userId,
        username: actor.username,
        // TENANT-1 (#196): tenant của phiên — claim `tid` trên token
        // AS nếu có, không thì tenant mặc định theo membership do
        // resolveActor phân giải.
        tenantId: verdict.identity.tenantId ?? actor.tenantId ?? null,
      },
      tokenScopes: verdict.identity.scopes,
      verifiedClientId: verdict.identity.clientId,
    };
  }
  const bridgeIdentity = await deps.bridgeAuth.authenticate(req.get('authorization'));
  if (!bridgeIdentity) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized: a valid GiaoKhoa access token is required',
      wwwAuthenticate: invalidTokenChallenge(base),
    };
  }
  return { ok: true, identity: bridgeIdentity, tokenScopes: BRIDGE_SCOPES, verifiedClientId: null };
}

type McpGateRejection = { status: number; code: number; message: string; wwwAuthenticate?: string; retryAfterSeconds?: number };

/**
 * Cổng scope + rate limit cho `tools/call` (không áp cho method khác):
 * tool có scope riêng mà trần hiệu lực không có → 403 + challenge
 * step-up gồm đủ scope còn thiếu trong một lần (research Phần 2.2);
 * batch tính rate-limit theo SỐ ITEM (hồ sơ 3.3: hạn mức tạo tính theo
 * câu), các tool khác một lượt gọi = một đơn vị. Trả null khi qua cổng.
 */
function gateToolCall(
  body: JsonRpcEnvelope,
  userId: string,
  effectiveScopes: readonly string[],
  deps: McpMountDeps,
  base: string,
): McpGateRejection | null {
  if (body.method !== 'tools/call') return null;
  const toolName = typeof body.params?.name === 'string' ? body.params.name : undefined;
  // Cổng scope ở tầng mount (cùng họ 401/429): tool có scope riêng mà
  // trần hiệu lực không có → 403 + challenge step-up.
  const requiredScope = toolName ? TOOL_REQUIRED_SCOPES[toolName] : undefined;
  if (requiredScope && !effectiveScopes.includes(requiredScope)) {
    return {
      status: 403,
      code: JSON_RPC.FORBIDDEN,
      message: `Insufficient scope: this tool requires "${requiredScope}"`,
      wwwAuthenticate: `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    };
  }
  const args = body.params?.arguments;
  const cost =
    toolName === 'create_questions_batch' &&
    typeof args === 'object' &&
    args !== null &&
    Array.isArray((args as { items?: unknown }).items)
      ? ((args as { items: unknown[] }).items.length ?? 1)
      : 1;
  const decision = deps.rateLimiter.check(userId, McpRateLimiter.bucketForTool(toolName), Date.now(), cost);
  if (!decision.allowed) {
    return {
      status: 429,
      code: JSON_RPC.RATE_LIMITED,
      message: 'Rate limit exceeded for this tool; retry later',
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  return null;
}

/**
 * Xử lý một request tới /mcp theo từng bước: method → đọc body → parse
 * JSON → validate header → xác thực → cổng scope/rate limit → chạy tool
 * trong ngữ cảnh tenant của phiên (ALS). Lỗi vận hành ngoài các bước
 * này do caller (server.all) bắt và trả -32603.
 */
async function handleMcpRequest(
  req: Request,
  res: Response,
  deps: McpMountDeps,
  handler: McpHttpHandler,
  baseOf: (req: Request) => string,
): Promise<void> {
  if (req.method !== 'POST') {
    // Kỷ nguyên modern không có GET stream riêng; legacy stateless
    // trả 405 cho GET/DELETE — uỷ cho handler của SDK quyết định.
    const webRes = await handler.fetch(toWebRequest(req, null), {});
    return pipeWebResponse(webRes, res);
  }
  const raw = await readRawBody(req);
  if (raw === null) {
    return jsonRpcError(res, 413, null, JSON_RPC.SERVER_ERROR, `Request body too large (limit ${MAX_BODY_BYTES / 1024} KB)`);
  }
  let body: JsonRpcEnvelope;
  try {
    body = JSON.parse(raw.toString('utf8')) as JsonRpcEnvelope;
  } catch {
    return jsonRpcError(res, 400, null, JSON_RPC.PARSE_ERROR, 'Parse error: request body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || typeof body.method !== 'string') {
    return jsonRpcError(res, 400, null, JSON_RPC.INVALID_REQUEST, 'Invalid Request: missing JSON-RPC method');
  }
  const headerError = validateRpcHeaders(req, body);
  if (headerError) return jsonRpcError(res, 400, body.id, headerError.code, headerError.message);
  const auth = await authenticateMcpRequest(req, raw, deps, baseOf(req));
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', auth.wwwAuthenticate);
    return jsonRpcError(res, auth.status, body.id, auth.status === 403 ? JSON_RPC.FORBIDDEN : JSON_RPC.UNAUTHORIZED, auth.message);
  }
  const { identity, tokenScopes, verifiedClientId } = auth;
  const effectiveScopes = deps.grantedScopes ?? tokenScopes;
  const rejection = gateToolCall(body, identity.userId, effectiveScopes, deps, baseOf(req));
  if (rejection) {
    if (rejection.wwwAuthenticate) res.setHeader('WWW-Authenticate', rejection.wwwAuthenticate);
    if (rejection.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(rejection.retryAfterSeconds));
    return jsonRpcError(res, rejection.status, body.id, rejection.code, rejection.message);
  }
  const authInfo: AuthInfo = {
    token: (req.get('authorization') ?? '').slice('Bearer '.length),
    // Đường OAuth: client_id ĐÃ ĐƯỢC AS XÁC THỰC trên token. Đường
    // cầu auth: chỉ còn clientInfo tự giới thiệu (truy vết).
    clientId: verifiedClientId ?? clientIdOf(body),
    scopes: [...effectiveScopes],
    extra: { userId: identity.userId, username: identity.username, ip: req.ip ?? null, tenantId: identity.tenantId },
  };
  // TENANT-1 (#196): toàn lượt thực thi tool chạy trong ngữ cảnh
  // tenant của PHIÊN (ALS) — pool gắn GUC theo ALS nên RLS
  // fail-closed giới hạn mọi truy vấn của tool trong tenant này;
  // bank đích của các tool ghi phân giải trong đúng tenant của
  // phiên. Phiên không phân giải được tenant → store không có
  // tenantId = fail-closed (chỉ thấy dữ liệu platform).
  const webRes = await tenantAls.run(
    { tenantId: identity.tenantId ?? undefined, userId: identity.userId },
    () => handler.fetch(toWebRequest(req, raw), { authInfo }),
  );
  return pipeWebResponse(webRes, res);
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
