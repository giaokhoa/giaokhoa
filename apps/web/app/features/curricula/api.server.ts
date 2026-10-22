import { data } from 'react-router';
import { apiData } from '#lib/http/data.server.js';
import type { ManagementFeedback } from './management';

type ResponseSchema<T> = {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
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
  const schema = '201' in endpoint.responses ? endpoint.responses[201] : endpoint.responses[200];
  return apiData(
    request,
    endpoint.path.replace(':id', encodeURIComponent(options.id ?? '')),
    schema,
    { method: endpoint.method, data: options.body },
  );
}

export async function deleteCurriculumResource(
  request: Request,
  endpoint: { method: string; path: string; responses: { 204: null } },
  id: string,
) {
  await apiData(request, endpoint.path.replace(':id', encodeURIComponent(id)), null, {
    method: endpoint.method,
  });
}

export function managementFailure(error: string, status = 400, fields?: Record<string, string>) {
  return data<ManagementFeedback>({ error, fields }, { status });
}

export async function managementError(error: unknown) {
  if (error instanceof Response && error.status >= 300 && error.status < 400) throw error;
  if (error instanceof Response) return managementFailure(await error.text(), error.status);
  return managementFailure('Không thể xử lý yêu cầu. Vui lòng thử lại.', 502);
}
