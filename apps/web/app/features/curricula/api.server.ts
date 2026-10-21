import { data } from 'react-router';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { ManagementFeedback } from './management';

type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export async function requestCurriculumApi<T>(
  request: Request,
  endpoint: {
    method: string;
    path: string;
    responses: { 200: ResponseSchema<T> } | { 201: ResponseSchema<T> };
  },
  options: { id?: string; body?: unknown } = {},
): Promise<T> {
  const status = '201' in endpoint.responses ? 201 : 200;
  const body = await sendRequest(request, endpoint, status, options);
  const schema = '201' in endpoint.responses ? endpoint.responses[201] : endpoint.responses[200];
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Response('Dữ liệu trả về không đúng hợp đồng API chương trình học.', { status: 502 });
  }
  return result.data;
}

export async function deleteCurriculumResource(
  request: Request,
  endpoint: { method: string; path: string; responses: { 204: null } },
  id: string,
) {
  await sendRequest(request, endpoint, 204, { id });
}

async function sendRequest(
  request: Request,
  endpoint: { method: string; path: string },
  expectedStatus: number,
  options: { id?: string; body?: unknown },
) {
  try {
    const response = await createApiClient(request).request<unknown>({
      url: endpoint.path.replace(':id', encodeURIComponent(options.id ?? '')),
      method: endpoint.method,
      data: options.body,
    });
    if (response.status !== expectedStatus) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể xử lý chương trình học.', {
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
      });
    }
    return response.data;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export function managementFailure(error: string, status = 400, fields?: Record<string, string>) {
  return data<ManagementFeedback>({ error, fields }, { status });
}

export async function managementError(error: unknown) {
  if (error instanceof Response) return managementFailure(await error.text(), error.status);
  return managementFailure(getRequestErrorMessage(error, 'Không thể xử lý yêu cầu.'), 502);
}
