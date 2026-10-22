import { curriculaContract } from '@giaokhoa/shared/http/curricula';
import { curriculumNodesContract } from '@giaokhoa/shared/http/curriculum-nodes';
import { learningOutcomesContract } from '@giaokhoa/shared/http/learning-outcomes';
import { subjectsContract } from '@giaokhoa/shared/http/subjects';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { data, Link, redirect } from 'react-router';
import { requireCapability } from '#features/workspace/access.server.js';
import {
  CurriculumErrorBoundary,
  CurriculumForm,
  DeleteForm,
  ManagementEmpty,
  NodeForm,
  OutcomeForm,
} from '#features/curricula/components/management-forms.js';
import {
  deleteCurriculumResource,
  managementError,
  managementFailure,
  requestCurriculumApi,
} from '#features/curricula/api.server.js';
import { parseManagementBody } from '#features/curricula/management.js';
import type { Route } from './+types/detail';

export const ErrorBoundary = CurriculumErrorBoundary;

function requireId(id: unknown) {
  const parsed = curriculaContract.get.pathParams.safeParse({ id });
  if (!parsed.success) throw new Response('Mã chương trình học không hợp lệ.', { status: 400 });
  return parsed.data.id;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCapability(request, 'platform:moderate');
  const id = requireId(params.id);
  const [curriculum, nodes, subjects] = await Promise.all([
    requestCurriculumApi(request, curriculaContract.get, { id }),
    requestCurriculumApi(request, curriculaContract.listNodes, { id }),
    requestCurriculumApi(request, subjectsContract.list),
  ]);
  const entries = await Promise.all(
    nodes.map(async (node) => ({
      node,
      outcomes: await requestCurriculumApi(request, curriculumNodesContract.listOutcomes, {
        id: node.id,
      }),
    })),
  );
  return { curriculum, entries, subjects };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCapability(request, 'platform:moderate');
  const curriculumId = requireId(params.id);
  const form = await request.formData();
  const intent = form.get('intent');
  const validIntents = [
    'curriculum-update',
    'curriculum-delete',
    'node-create',
    'node-update',
    'node-delete',
    'outcome-create',
    'outcome-update',
    'outcome-delete',
  ];
  if (typeof intent !== 'string' || !validIntents.includes(intent)) {
    return managementFailure('Thao tác không hợp lệ.');
  }
  const [entity, operation] = intent.split('-') as [
    'curriculum' | 'node' | 'outcome',
    'create' | 'update' | 'delete',
  ];
  const submittedId = form.get('id');
  const resourceId =
    entity === 'curriculum' ? curriculumId : typeof submittedId === 'string' ? submittedId : '';
  const contract =
    entity === 'curriculum'
      ? curriculaContract
      : entity === 'node'
        ? curriculumNodesContract
        : learningOutcomesContract;
  if (operation !== 'create') {
    const validId = contract.get.pathParams.safeParse({ id: resourceId });
    if (!validId.success) return managementFailure('Mã tài nguyên không hợp lệ.');
  }

  try {
    if (operation === 'delete') {
      if (entity === 'curriculum') {
        await deleteCurriculumResource(request, curriculaContract.delete, curriculumId);
        return redirect('/curricula');
      }
      if (entity === 'node') {
        await deleteCurriculumResource(request, curriculumNodesContract.delete, resourceId);
      } else {
        await deleteCurriculumResource(request, learningOutcomesContract.delete, resourceId);
      }
      return data({ success: 'Đã xóa dữ liệu.' });
    }

    const submittedParentId = form.get('nodeId');
    const parentId = typeof submittedParentId === 'string' ? submittedParentId : '';
    if (
      entity === 'outcome' &&
      operation === 'create' &&
      !curriculumNodesContract.get.pathParams.safeParse({ id: parentId }).success
    ) {
      return managementFailure('Mã nút học tập không hợp lệ.');
    }
    const parsed = parseManagementBody(
      form,
      entity,
      operation,
      entity === 'node' ? curriculumId : entity === 'outcome' ? parentId : undefined,
    );
    if (!parsed.success) {
      return managementFailure('Vui lòng kiểm tra dữ liệu nhập.', 400, parsed.fields);
    }
    if (entity === 'curriculum') {
      await requestCurriculumApi(request, curriculaContract.update, {
        id: curriculumId,
        body: parsed.data,
      });
    } else if (entity === 'node') {
      await requestCurriculumApi(
        request,
        operation === 'create' ? curriculumNodesContract.create : curriculumNodesContract.update,
        { id: operation === 'create' ? undefined : resourceId, body: parsed.data },
      );
    } else {
      await requestCurriculumApi(
        request,
        operation === 'create' ? learningOutcomesContract.create : learningOutcomesContract.update,
        { id: operation === 'create' ? undefined : resourceId, body: parsed.data },
      );
    }
    return data({ success: 'Đã lưu thay đổi.' });
  } catch (error) {
    return managementError(error);
  }
}

export default function CurriculumDetail({ loaderData }: Route.ComponentProps) {
  const { curriculum, entries, subjects } = loaderData;
  const subject = subjects.find((item) => item.id === curriculum.subjectId);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Chương trình {subject?.name ?? curriculum.subjectId}
          </h1>
          <p className="text-sm text-muted-foreground">Khối lớp {curriculum.grade}</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link to="/curricula" />}>
          Về danh sách
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sửa chương trình</CardTitle>
            <CardDescription>Thay đổi môn học hoặc khối lớp.</CardDescription>
          </CardHeader>
          <CardContent>
            <CurriculumForm curriculum={curriculum} subjects={subjects} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quản lý chương trình</CardTitle>
            <CardDescription>Mã chương trình: {curriculum.id}.</CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteForm entity="curriculum" id={curriculum.id} label="Xóa chương trình" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Thêm nút chương trình</CardTitle>
          <CardDescription>
            Tạo chương, bài hoặc nút học tập theo cấu trúc chương trình.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NodeForm />
        </CardContent>
      </Card>
      <section className="flex flex-col gap-4" aria-label="Các nút và mục tiêu học tập">
        <h2 className="text-xl font-semibold">Nội dung chương trình</h2>
        {entries.length === 0 && (
          <ManagementEmpty
            title="Chưa có nút chương trình"
            description="Dùng biểu mẫu phía trên để tạo nút đầu tiên."
          />
        )}
        {entries.map(({ node, outcomes }) => (
          <Card key={node.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle>{node.title}</CardTitle>
                <Badge variant="secondary">Vị trí {node.position}</Badge>
              </div>
              <CardDescription>
                Mã nút: {node.id}. {node.parentId ? 'Nút cha: ' + node.parentId : 'Nút gốc'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
              <div className="grid gap-4 lg:grid-cols-2">
                <NodeForm node={node} />
                <DeleteForm entity="node" id={node.id} label="Xóa nút" />
              </div>
              <h3 className="font-semibold">Mục tiêu học tập</h3>
              {outcomes.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Chưa có mục tiêu học tập</EmptyTitle>
                    <EmptyDescription>
                      Thêm mục tiêu cho nút này ở biểu mẫu bên dưới.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {outcomes.map((outcome) => (
                <Card key={outcome.id}>
                  <CardHeader>
                    <CardTitle>Mục tiêu {outcome.position}</CardTitle>
                    <CardDescription>{outcome.content}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid lg:grid-cols-2">
                    <OutcomeForm nodeId={node.id} outcome={outcome} />
                    <DeleteForm
                      entity="outcome"
                      id={outcome.id}
                      nodeId={node.id}
                      label="Xóa mục tiêu"
                    />
                  </CardContent>
                </Card>
              ))}
              <OutcomeForm nodeId={node.id} />
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
