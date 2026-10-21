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
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
      });
    }

    const result = subjectsContract.list.responses[200].safeParse(response.data);
    if (!result.success) {
      throw new Response('Phản hồi API không đúng hợp đồng môn học.', { status: 502 });
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
  // Giữ tương thích với biểu mẫu sửa cũ chưa gửi loại thao tác.
  const intent = data.get('intent') ?? 'update';
  if (intent !== 'create' && intent !== 'update' && intent !== 'delete') {
    return Response.json({ error: 'Thao tác môn học không hợp lệ.' }, { status: 400 });
  }

  const endpoint = subjectsContract[intent];
  let id: string | undefined;
  if ('pathParams' in endpoint) {
    const result = endpoint.pathParams.safeParse({ id: data.get('id') });
    if (!result.success) {
      return Response.json({ error: 'Mã môn học không hợp lệ.' }, { status: 400 });
    }
    id = result.data.id;
  }

  const position = data.get('position');
  const bodyResult =
    intent === 'delete'
      ? null
      : subjectsContract[intent].body.safeParse({
          name: data.get('name'),
          slug: data.get('slug'),
          position:
            typeof position === 'string' && position.trim() !== ''
              ? Number(position)
              : intent === 'create' && (position === null || position === '')
                ? undefined
                : NaN,
        });
  if (bodyResult && !bodyResult.success) {
    const messages: Record<string, string> = {
      name: 'Tên môn học không được để trống.',
      slug: 'Mã đường dẫn chỉ gồm chữ thường không dấu, chữ số và dấu gạch nối giữa các từ.',
      position: 'Thứ tự phải là số nguyên từ 1 đến 2147483647.',
    };
    const fieldErrors = Object.fromEntries(
      bodyResult.error.issues.map((issue) => {
        const field = String(issue.path[0]);
        return [field, messages[field] ?? 'Dữ liệu môn học không hợp lệ.'];
      }),
    );
    return Response.json(
      { error: Object.values(fieldErrors).join(' '), fieldErrors },
      { status: 400 },
    );
  }

  try {
    const response = await createApiClient(request).request<unknown>({
      url: endpoint.path.replace(':id', encodeURIComponent(id ?? '')),
      method: endpoint.method,
      data: bodyResult?.data,
    });

    const expectedStatus = intent === 'delete' ? 204 : intent === 'create' ? 201 : 200;
    if (response.status !== expectedStatus) {
      return Response.json(
        {
          error:
            getApiErrorMessage(response.data) ??
            (intent === 'create'
              ? 'Không thể tạo môn học.'
              : intent === 'delete'
                ? 'Không thể xóa môn học.'
                : 'Không thể cập nhật môn học.'),
        },
        { status: response.status >= 400 && response.status <= 599 ? response.status : 502 },
      );
    }

    if (intent === 'delete') return Response.json({ deleted: true });

    const schema =
      intent === 'create'
        ? subjectsContract.create.responses[201]
        : subjectsContract.update.responses[200];
    const result = schema.safeParse(response.data);
    if (!result.success) {
      return Response.json({ error: 'Phản hồi API không đúng hợp đồng môn học.' }, { status: 502 });
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
