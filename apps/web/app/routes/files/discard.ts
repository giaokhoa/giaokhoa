import { filesContract } from '@giaokhoa/shared/http/files';
import { createApiClient } from '#lib/http/api.server.js';
import type { Route } from './+types/discard';

export async function action({ request }: Route.ActionArgs) {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = filesContract.discard.body.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });

  const response = await createApiClient(request).request({
    url: filesContract.discard.path,
    method: filesContract.discard.method,
    data: parsed.data,
  });

  if (response.status === 204) return new Response(null, { status: 204 });
  return Response.json(response.data ?? null, { status: response.status });
}
