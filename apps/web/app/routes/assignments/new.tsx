import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { data, redirect } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { AssignmentForm } from '#features/assignments/assignment-form.js';
import {
  assignmentDateFields,
  assignmentFieldErrors,
  normalizeDates,
  readAssignmentForm,
} from '#features/assignments/assignment-data.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/new';

export { AssignmentErrorBoundary as ErrorBoundary } from '#features/assignments/assignment-form.js';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  const search = new URL(request.url).searchParams;
  return {
    classId: search.get('classId') ?? '',
    examRevisionId: search.get('examRevisionId') ?? '',
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const parsed = readAssignmentForm(await request.formData());
  if (!parsed.success) {
    return data(
      {
        error: 'Vui lòng kiểm tra cấu hình bài giao.',
        fieldErrors: assignmentFieldErrors(parsed.error.issues),
      },
      { status: 400 },
    );
  }
  try {
    const response = await createApiClient(request).request<unknown>({
      url: assignmentsContract.create.path,
      method: assignmentsContract.create.method,
      data: parsed.data,
    });
    if (response.status !== 201) {
      return data(
        { error: getApiErrorMessage(response.data) ?? 'Không thể tạo bài giao.', fieldErrors: {} },
        { status: response.status },
      );
    }
    const result = assignmentsContract.create.responses[201].safeParse(
      normalizeDates(response.data, assignmentDateFields),
    );
    if (!result.success)
      return data(
        { error: 'Phản hồi bài giao không đúng hợp đồng API.', fieldErrors: {} },
        { status: 502 },
      );
    return redirect(`/assignments/${result.data.id}`);
  } catch (error) {
    return data(
      { error: getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), fieldErrors: {} },
      { status: 502 },
    );
  }
}

export default function NewAssignment({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Giao bài mới</h1>
      <AssignmentForm
        {...loaderData}
        error={actionData?.error}
        fieldErrors={actionData?.fieldErrors}
      />
    </main>
  );
}
