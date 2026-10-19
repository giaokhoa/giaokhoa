import { curriculaContract } from '@giaokhoa/shared/http/curricula';
import { subjectsContract } from '@giaokhoa/shared/http/subjects';
import { requireSession } from '#features/auth/api/session.server.js';
import { CurriculumMatrix } from '#features/curricula/components/curriculum-matrix.js';
import { createApiClient } from '#lib/http/api.server.js';
import { getApiErrorMessage, getRequestErrorMessage } from '#lib/http/errors.js';
import type { Route } from './+types/curricula';

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);

  try {
    const api = createApiClient(request);
    const [subjectsResponse, curriculaResponse] = await Promise.all([
      api.request<unknown>({
        url: subjectsContract.list.path,
        method: subjectsContract.list.method,
      }),
      api.request<unknown>({
        url: curriculaContract.list.path,
        method: curriculaContract.list.method,
      }),
    ]);

    if (subjectsResponse.status !== 200) {
      throw new Response(
        getApiErrorMessage(subjectsResponse.data) ?? 'Không thể tải danh sách môn học.',
        { status: subjectsResponse.status },
      );
    }
    if (curriculaResponse.status !== 200) {
      throw new Response(
        getApiErrorMessage(curriculaResponse.data) ?? 'Không thể tải danh sách chương trình học.',
        { status: curriculaResponse.status },
      );
    }

    const subjects = subjectsContract.list.responses[200].safeParse(subjectsResponse.data);
    if (!subjects.success) {
      throw new Response('Phản hồi API không đúng subjects contract.', { status: 502 });
    }

    const curricula = curriculaContract.list.responses[200].safeParse(curriculaResponse.data);
    if (!curricula.success) {
      throw new Response('Phản hồi API không đúng curricula contract.', { status: 502 });
    }

    const gradesBySubject = new Map<string, number[]>();
    for (const curriculum of curricula.data) {
      const grades = gradesBySubject.get(curriculum.subjectId);
      if (grades) grades.push(curriculum.grade);
      else gradesBySubject.set(curriculum.subjectId, [curriculum.grade]);
    }

    return {
      rows: subjects.data.map((subject) => ({
        ...subject,
        grades: gradesBySubject.get(subject.id) ?? [],
      })),
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(getRequestErrorMessage(error, 'Không thể kết nối đến máy chủ.'), {
      status: 502,
    });
  }
}

export default function Curricula({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Chương trình học</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ma trận chương trình môn học theo lớp từ lớp 1 đến lớp 12.
        </p>
      </div>
      <CurriculumMatrix rows={loaderData.rows} />
    </main>
  );
}
