import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import { assignmentDateFields, normalizeDates } from './assignment-data.js';

export function requireAssignmentId(id: string | undefined): string {
  const result = assignmentsContract.get.pathParams.safeParse({ id });
  if (!result.success) throw new Response('Mã bài giao không hợp lệ.', { status: 400 });
  return result.data.id;
}

export async function loadAssignment(request: Request, id: string) {
  try {
    const response = await createApiClient(request).request<unknown>({
      url: assignmentsContract.get.path.replace(':id', encodeURIComponent(id)),
      method: assignmentsContract.get.method,
    });
    if (response.status !== 200) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể tải bài giao.', {
        status: response.status,
      });
    }
    const result = assignmentsContract.get.responses[200].safeParse(
      normalizeDates(response.data, assignmentDateFields),
    );
    if (!result.success)
      throw new Response('Phản hồi bài giao không đúng hợp đồng API.', { status: 502 });
    return result.data;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}
