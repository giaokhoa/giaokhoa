import { filesContract } from '@giaokhoa/shared/http/files';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import type { Route } from './+types/create-variant';

export async function action({ request, params }: Route.ActionArgs) {
  const parsedParams = filesContract.uploadVariant.pathParams.safeParse(params);
  if (!parsedParams.success) return new Response(null, { status: 404 });

  const path = filesContract.uploadVariant.path.replace(
    ':id',
    encodeURIComponent(parsedParams.data.id),
  );
  const response = await createApiClient(request).request<unknown>({
    url: path,
    method: filesContract.uploadVariant.method,
    data: await request.formData(),
  });

  if (!isSuccessStatus(response.status)) {
    return Response.json(response.data ?? null, { status: response.status });
  }

  const parsed = filesContract.uploadVariant.responses[201].safeParse(response.data);
  if (!parsed.success) {
    return Response.json({ message: 'Phản hồi upload file không hợp lệ' }, { status: 502 });
  }

  return Response.json(parsed.data, { status: response.status });
}
