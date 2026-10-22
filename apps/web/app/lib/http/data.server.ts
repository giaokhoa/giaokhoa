import { data, redirect } from 'react-router';
import { createApiClient } from './api.server.js';
import { getApiErrorMessage } from './errors.js';
import { reviveApiDates } from './dates.js';

type Schema<T> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string; code?: string }> } };
};

export function parseInput<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Response(
      result.error.issues
        .filter((issue) => issue.code === 'custom')
        .map((issue) => issue.message)
        .join('; ') || 'Dữ liệu không hợp lệ. Vui lòng kiểm tra các trường đã nhập.',
      {
        status: 400,
      },
    );
  return result.data;
}

export async function apiData<T>(
  request: Request,
  path: string,
  schema: Schema<T> | null,
  options: { method?: string; data?: unknown } = {},
): Promise<T> {
  let response;
  try {
    response = await createApiClient(request).request<unknown>({ url: path, ...options });
  } catch {
    throw new Response('Không thể kết nối đến máy chủ. Vui lòng thử lại.', { status: 502 });
  }
  if (response.status === 401) {
    const url = new URL(request.url);
    throw redirect(`/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (response.status < 200 || response.status >= 300)
    throw new Response(getApiErrorMessage(response.data) ?? 'Không thể thực hiện yêu cầu.', {
      status: response.status,
    });
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(reviveApiDates(response.data));
  if (!parsed.success) throw new Response('Dữ liệu máy chủ trả về không hợp lệ.', { status: 502 });
  return parsed.data;
}

export async function actionError(error: unknown) {
  if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
  return data(
    {
      error:
        error instanceof Response
          ? await error.text()
          : 'Không thể thực hiện thao tác. Vui lòng thử lại.',
    },
    { status: error instanceof Response ? error.status : 502 },
  );
}

export function routeId(value: unknown, schema: Schema<{ id: string }>) {
  return parseInput(schema, { id: value }).id;
}
