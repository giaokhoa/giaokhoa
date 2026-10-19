import { imagesContract } from '@giaokhoa/shared/http/images';
import { createApiClient } from '#lib/http/api.server.js';
import type { Route } from './+types/discard';

export async function action({ request }: Route.ActionArgs) {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = imagesContract.discard.body.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });

  const response = await createApiClient(request).request({
    url: imagesContract.discard.path,
    method: imagesContract.discard.method,
    data: parsed.data,
  });

  if (response.status === 204) return new Response(null, { status: 204 });
  return Response.json(response.data ?? null, { status: response.status });
}
