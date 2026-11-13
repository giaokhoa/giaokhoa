import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpProtectedRequestHandler } from '@better-auth/mcp';

export interface McpOAuthIdentity {
  userId: string;
  clientId: string;
  scopes: string[];
  tenantId: string | null;
}

export type McpOAuthVerifyResult =
  | { ok: true; identity: McpOAuthIdentity }
  | { ok: false; status: number; wwwAuthenticate: string | null };

interface ClaimsCapture {
  claims?: { sub?: unknown; client_id?: unknown; scope?: unknown; tid?: unknown };
}

export class McpOAuthVerifier {
  private readonly capture = new AsyncLocalStorage<ClaimsCapture>();
  private readonly handler: (request: Request) => Promise<Response>;

  constructor(options: { issuer: string; audience: string; jwksUrl: string }) {
    this.handler = createMcpProtectedRequestHandler(
      { issuer: options.issuer, audience: options.audience, jwksUrl: options.jwksUrl },
      async (_request, claims) => {
        const store = this.capture.getStore();
        if (store) store.claims = claims;
        return new Response(null, { status: 204 });
      },
    );
  }

  async verify(request: Request): Promise<McpOAuthVerifyResult> {
    const store: ClaimsCapture = {};
    const response = await this.capture.run(store, () => this.handler(request));
    const claims = store.claims;
    if (!claims) {
      return {
        ok: false,
        status: response.status,
        wwwAuthenticate: response.headers.get('www-authenticate'),
      };
    }
    return {
      ok: true,
      identity: {
        userId: typeof claims.sub === 'string' ? claims.sub : '',
        clientId: typeof claims.client_id === 'string' ? claims.client_id : 'unknown',
        scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
        tenantId: typeof claims.tid === 'string' ? claims.tid : null,
      },
    };
  }
}
