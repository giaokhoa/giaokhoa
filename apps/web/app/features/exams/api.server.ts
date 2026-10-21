import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import { normalizeExamDates } from './data';

type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export async function requestExamApi<T>(
  request: Request,
  endpoint: {
    method: string;
    path: string;
    responses: { 200: ResponseSchema<T> } | { 201: ResponseSchema<T> };
  },
  options: { id?: string; revision?: number; body?: unknown } = {},
): Promise<T> {
  try {
    const response = await createApiClient(request).request<unknown>({
      url: endpoint.path
        .replace(':id', encodeURIComponent(options.id ?? ''))
        .replace(':revision', String(options.revision ?? '')),
      method: endpoint.method,
      data: options.body,
    });
    const expectedStatus = '201' in endpoint.responses ? 201 : 200;
    if (response.status !== expectedStatus) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể xử lý yêu cầu đề thi.', {
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
      });
    }

    const schema = '201' in endpoint.responses ? endpoint.responses[201] : endpoint.responses[200];
    const result = schema.safeParse(normalizeExamDates(response.data));
    if (!result.success) {
      throw new Response('Dữ liệu đề thi trả về không đúng hợp đồng API.', { status: 502 });
    }
    return result.data;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}
