import { examsContract } from '@giaokhoa/shared/http/exams';
import { Button } from '@giaokhoa/ui/components/button';
import { FieldGroup } from '@giaokhoa/ui/components/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Form, Link, redirect } from 'react-router';
import { getAccess, requireCapability } from '#features/workspace/access.server.js';
import {
  EmptyList,
  Feedback,
  InputField,
  Page,
  Panel,
  SubmitButton,
} from '#features/workspace/ui.js';
import { actionError, apiData, parseInput } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/index';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request }: Route.LoaderArgs) {
  const access = await getAccess(request);
  if (!access.capabilities.some((key) => ['exam:create_own', 'exam:manage_own'].includes(key)))
    throw new Response('Bạn không có quyền quản lý đề thi.', { status: 403 });
  return {
    access,
    exams: access.capabilities.includes('exam:manage_own')
      ? await apiData(request, '/exams', examsContract.list.responses[200])
      : [],
  };
}
export async function action({ request }: Route.ActionArgs) {
  try {
    await requireCapability(request, 'exam:create_own');
    const form = await request.formData();
    const body = parseInput(examsContract.create.body, { title: form.get('title') });
    const exam = await apiData(request, '/exams', examsContract.create.responses[201], {
      method: 'POST',
      data: body,
    });
    return redirect(`/exams/${exam.id}`);
  } catch (error) {
    return actionError(error);
  }
}
export default function Exams({ loaderData: { access, exams }, actionData }: Route.ComponentProps) {
  return (
    <Page title="Đề thi" description="Soạn đề và chốt phiên bản câu hỏi trước khi giao bài.">
      <Feedback {...actionData} />
      {access.capabilities.includes('exam:create_own') && (
        <Panel title="Tạo đề thi">
          <Form method="post">
            <FieldGroup>
              <InputField name="title" label="Tên đề thi" required maxLength={200} />
              <SubmitButton>Tạo đề thi</SubmitButton>
            </FieldGroup>
          </Form>
        </Panel>
      )}
      <Panel title="Đề thi của bạn">
        {!exams.length ? (
          <EmptyList />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên đề</TableHead>
                <TableHead>Cập nhật</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell>{exam.title}</TableCell>
                  <TableCell>{formatDate(exam.updatedAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link to={`/exams/${exam.id}`} />}
                    >
                      Mở đề
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
