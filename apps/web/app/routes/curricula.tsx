import { curriculaContract } from '@giaokhoa/shared/http/curricula';
import { subjectsContract } from '@giaokhoa/shared/http/subjects';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Link, redirect } from 'react-router';
import { requireSession } from '#features/auth/api/session.server.js';
import { CurriculumMatrix } from '#features/curricula/components/curriculum-matrix.js';
import {
  CurriculumForm,
  CurriculumErrorBoundary,
  ManagementEmpty,
} from '#features/curricula/components/management-forms.js';
import {
  managementError,
  managementFailure,
  requestCurriculumApi,
} from '#features/curricula/api.server.js';
import { parseManagementBody } from '#features/curricula/management.js';
import type { Route } from './+types/curricula';

export const ErrorBoundary = CurriculumErrorBoundary;

export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  const [subjects, curricula] = await Promise.all([
    requestCurriculumApi(request, subjectsContract.list),
    requestCurriculumApi(request, curriculaContract.list),
  ]);
  const gradesBySubject = new Map<string, number[]>();
  for (const curriculum of curricula) {
    const grades = gradesBySubject.get(curriculum.subjectId);
    if (grades) grades.push(curriculum.grade);
    else gradesBySubject.set(curriculum.subjectId, [curriculum.grade]);
  }
  return {
    subjects,
    curricula,
    rows: subjects.map((subject) => ({
      ...subject,
      grades: gradesBySubject.get(subject.id) ?? [],
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireSession(request);
  const form = await request.formData();
  if (form.get('intent') !== 'curriculum-create') {
    return managementFailure('Thao tác không hợp lệ.');
  }
  const parsed = parseManagementBody(form, 'curriculum', 'create');
  if (!parsed.success) {
    return managementFailure('Vui lòng kiểm tra thông tin chương trình.', 400, parsed.fields);
  }
  try {
    const created = await requestCurriculumApi(request, curriculaContract.create, {
      body: parsed.data,
    });
    return redirect('/curricula/' + created.id);
  } catch (error) {
    return managementError(error);
  }
}

export default function Curricula({ loaderData }: Route.ComponentProps) {
  const { subjects, curricula, rows } = loaderData;
  const names = new Map(subjects.map((subject) => [subject.id, subject.name]));
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Chương trình học</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ma trận chương trình môn học theo lớp từ lớp 1 đến lớp 12.
        </p>
      </div>
      <CurriculumMatrix rows={rows} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tạo chương trình</CardTitle>
            <CardDescription>Chọn môn và lớp trước khi thêm nội dung học tập.</CardDescription>
          </CardHeader>
          <CardContent>
            <CurriculumForm subjects={subjects} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Danh sách chương trình</CardTitle>
            <CardDescription>
              Mở chương trình để quản lý các nút và mục tiêu học tập.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {curricula.length === 0 ? (
              <ManagementEmpty
                title="Chưa có chương trình"
                description="Tạo một chương trình theo môn học và lớp để bắt đầu."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Môn học</TableHead>
                    <TableHead>Lớp</TableHead>
                    <TableHead>Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {curricula.map((curriculum) => (
                    <TableRow key={curriculum.id}>
                      <TableCell>
                        {names.get(curriculum.subjectId) ?? curriculum.subjectId}
                      </TableCell>
                      <TableCell>{curriculum.grade}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          render={<Link to={'/curricula/' + curriculum.id} />}
                        >
                          Quản lý
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
