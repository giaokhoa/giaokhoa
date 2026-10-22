import { questionsContract } from '@giaokhoa/shared/http/questions';
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
import { Form, Link } from 'react-router';
import { getAccess, requireCapability } from '#features/workspace/access.server.js';
import { questionText, questionTypeLabels } from '#features/workspace/question-preview.js';
import {
  EmptyList,
  Feedback,
  InlineAction,
  InputField,
  Page,
  Panel,
} from '#features/workspace/ui.js';
import { Status } from '#features/workspace/ui.js';
import { actionError, apiData, routeId } from '#lib/http/data.server.js';
import type { Route } from './+types/index';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireCapability(request, 'question:manage_own');
  const questions = await apiData(
    request,
    questionsContract.list.path,
    questionsContract.list.responses[200],
  );
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const system = await getAccess(request);
  return {
    questions: questions
      .filter((item) =>
        questionText(item.content)
          .toLocaleLowerCase('vi-VN')
          .includes(q.toLocaleLowerCase('vi-VN')),
      )
      .reverse(),
    q,
    canCreate: system.capabilities.includes('question:create_own'),
    access,
  };
}
export async function action({ request }: Route.ActionArgs) {
  try {
    await requireCapability(request, 'question:manage_own');
    const form = await request.formData();
    if (form.get('intent') !== 'delete')
      throw new Response('Thao tác không hợp lệ.', { status: 400 });
    const id = routeId(form.get('id'), questionsContract.delete.pathParams);
    await apiData(request, `/questions/${id}`, null, { method: 'DELETE' });
    return { success: 'Đã xóa câu hỏi.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function Questions({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page
      title="Ngân hàng câu hỏi"
      description="Quản lý câu hỏi và các phiên bản nội dung của riêng bạn."
      actions={
        loaderData.canCreate && (
          <Button nativeButton={false} render={<Link to="/questions/new" />}>
            Thêm câu hỏi
          </Button>
        )
      }
    >
      <Feedback {...actionData} />
      <Form method="get">
        <FieldGroup>
          <InputField
            name="q"
            label="Tìm theo nội dung"
            defaultValue={loaderData.q}
            type="search"
          />
          <Button type="submit" variant="outline">
            Tìm câu hỏi
          </Button>
        </FieldGroup>
      </Form>
      <Panel title="Câu hỏi của bạn">
        {!loaderData.questions.length ? (
          <EmptyList>Chưa có câu hỏi phù hợp.</EmptyList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nội dung</TableHead>
                <TableHead>Dạng</TableHead>
                <TableHead>Phiên bản</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaderData.questions.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      to={`/questions/${item.id}`}
                      className="line-clamp-2 max-w-md underline underline-offset-4"
                    >
                      {questionText(item.content) || 'Câu hỏi chưa có nội dung'}
                    </Link>
                  </TableCell>
                  <TableCell>{questionTypeLabels[item.type]}</TableCell>
                  <TableCell>{item.version}</TableCell>
                  <TableCell>
                    <Status value={item.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={`/questions/${item.id}/history`} />}
                      >
                        Lịch sử
                      </Button>
                      <InlineAction
                        intent="delete"
                        label="Xóa"
                        fields={{ id: item.id }}
                        confirm="Xóa câu hỏi và các phiên bản? Những câu đã được sử dụng có thể không được phép xóa."
                      />
                    </div>
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
