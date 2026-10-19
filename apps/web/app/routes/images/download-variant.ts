import { imagesContract } from '@giaokhoa/shared/http/images';
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
  const parsedParams = imagesContract.getVariant.pathParams.safeParse(params);
  if (!parsedParams.success) return new Response(null, { status: 404 });

  const path = imagesContract.getVariant.path
    .replace(':id', encodeURIComponent(parsedParams.data.id))
    .replace(':imageVariantId', encodeURIComponent(parsedParams.data.imageVariantId));
  const response = await createApiClient(request).request<ReadableStream>({
    url: path,
    method: imagesContract.getVariant.method,
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
