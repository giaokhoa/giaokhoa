import { imagesContract } from '@giaokhoa/shared/http/images';
import { createApiClient, isSuccessStatus } from '#lib/http/api.server.js';
import type { Route } from './+types/upload';

export async function action({ request }: Route.ActionArgs) {
  const response = await createApiClient(request).request<unknown>({
    url: imagesContract.upload.path,
    method: imagesContract.upload.method,
    data: await request.formData(),
  });

  if (!isSuccessStatus(response.status)) {
    return Response.json(response.data ?? null, { status: response.status });
  }

  const parsed = imagesContract.upload.responses[201].safeParse(response.data);
  if (!parsed.success) {
    return Response.json({ message: 'Phản hồi upload ảnh không hợp lệ' }, { status: 502 });
  }

  return Response.json(parsed.data, { status: response.status });
}
