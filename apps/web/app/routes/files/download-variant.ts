import { filesContract } from '@giaokhoa/shared/http/files';
import { createApiClient } from '#lib/http/api.server.js';
import type { Route } from './+types/download-variant';

const PROXIED_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'x-content-type-options',
] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const parsedParams = filesContract.getVariant.pathParams.safeParse(params);
  if (!parsedParams.success) return new Response(null, { status: 404 });

  const path = filesContract.getVariant.path
    .replace(':id', encodeURIComponent(parsedParams.data.id))
    .replace(':variantId', encodeURIComponent(parsedParams.data.variantId));
  const response = await createApiClient(request).request<ReadableStream>({
    url: path,
    method: filesContract.getVariant.method,
    responseType: 'stream',
  });

  const headers = new Headers();
  for (const name of PROXIED_HEADERS) {
    const value = response.headers[name];
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value != null) headers.set(name, String(value));
  }

  return new Response(response.data, { status: response.status, headers });
}
