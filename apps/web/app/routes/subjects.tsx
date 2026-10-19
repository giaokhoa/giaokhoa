import { subjectsContract } from '@giaokhoa/shared/http/subjects';
import { requireSession } from '#features/auth/api/session.server.js';
import { SubjectsTable } from '#features/subjects/components/subjects-table.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/subjects';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);

  try {
    const response = await createApiClient(request).request<unknown>({
      url: subjectsContract.list.path,
      method: subjectsContract.list.method,
    });

    if (response.status !== 200) {
      throw new Response(getApiErrorMessage(response.data) ?? 'Không thể tải danh sách môn học.', {
        status: response.status,
      });
    }

    const result = subjectsContract.list.responses[200].safeParse(response.data);
    if (!result.success) {
      throw new Response('Phản hồi API không đúng subjects contract.', { status: 502 });
    }

    return { subjects: result.data };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);

  const data = await request.formData();
  const idResult = subjectsContract.update.pathParams.safeParse({ id: data.get('id') });
  const patchResult = subjectsContract.update.body.safeParse({
    name: data.get('name'),
    slug: data.get('slug'),
    position: Number(data.get('position')),
  });
  if (!idResult.success || !patchResult.success) {
    const issues = [
      ...(idResult.success ? [] : idResult.error.issues),
      ...(patchResult.success ? [] : patchResult.error.issues),
    ];
    return Response.json(
      { error: issues[0]?.message ?? 'Dữ liệu môn học không hợp lệ.' },
      { status: 400 },
    );
  }

  try {
    const response = await createApiClient(request).request<unknown>({
      url: subjectsContract.update.path.replace(':id', encodeURIComponent(idResult.data.id)),
      method: subjectsContract.update.method,
      data: patchResult.data,
    });

    if (response.status !== 200) {
      return Response.json(
        { error: getApiErrorMessage(response.data) ?? 'Không thể cập nhật môn học.' },
        { status: response.status },
      );
    }

    const result = subjectsContract.update.responses[200].safeParse(response.data);
    if (!result.success) {
      return Response.json(
        { error: 'Phản hồi API không đúng subjects contract.' },
        { status: 502 },
      );
    }

    return Response.json({ subject: result.data });
  } catch (error) {
    return Response.json(
      { error: getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.') },
      { status: 502 },
    );
  }
}

export default function Subjects({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Môn học</h1>
        <p className="mt-1 text-sm text-muted-foreground">Danh sách môn học trong hệ thống.</p>
      </div>
      <SubjectsTable subjects={loaderData.subjects} />
    </main>
  );
}
