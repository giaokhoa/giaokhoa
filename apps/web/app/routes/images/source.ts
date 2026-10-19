import { imagesContract } from '@giaokhoa/shared/http/images';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import type { Route } from './+types/source';

export async function loader({ request, params }: Route.LoaderArgs) {
  const parsedParams = imagesContract.getSource.pathParams.safeParse(params);
  if (!parsedParams.success) return new Response(null, { status: 404 });

  const path = imagesContract.getSource.path.replace(
    ':id',
    encodeURIComponent(parsedParams.data.id),
  );
  const response = await createApiClient(request).request<unknown>({
    url: path,
    method: imagesContract.getSource.method,
  });

  const headers = { 'cache-control': 'no-store' };
  if (!isSuccessStatus(response.status)) {
    return Response.json(response.data ?? null, { status: response.status, headers });
  }

  const parsed = imagesContract.getSource.responses[200].safeParse(response.data);
  if (!parsed.success) {
    return Response.json({ message: 'Phản hồi nguồn ảnh không hợp lệ' }, { status: 502, headers });
  }

  return Response.json(parsed.data, { status: response.status, headers });
}
