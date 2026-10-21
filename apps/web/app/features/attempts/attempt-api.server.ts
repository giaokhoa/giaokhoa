import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import { normalizeAttemptDates } from './attempt-data';

type ResponseSchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
};

export async function requestAttemptApi<T>(
  request: Request,
  endpoint: { path: string; method: string; responses: { 200: ResponseSchema<T> } },
  params: Record<string, string | number>,
  body?: unknown,
  normalize: (value: unknown) => unknown = normalizeAttemptDates,
) {
  try {
    let url = endpoint.path;
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(String(value)));
    }
    const response = await createApiClient(request).request<unknown>({
      url,
      method: endpoint.method,
      data: body,
    });
    if (response.status !== 200) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể thực hiện yêu cầu.', {
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
      });
    }
    const parsed = endpoint.responses[200].safeParse(normalize(response.data));
    if (!parsed.success) {
      throw new Response('Dữ liệu máy chủ trả về không đúng cấu trúc yêu cầu.', { status: 502 });
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export async function optionalAttemptData<T>(operation: Promise<T>) {
  try {
    return { value: await operation, error: null };
  } catch (error) {
    return {
      value: null,
      error:
        error instanceof Response
          ? await error.text()
          : getRequestErrorMessage(error, 'Không thể tải dữ liệu.'),
    };
  }
}
