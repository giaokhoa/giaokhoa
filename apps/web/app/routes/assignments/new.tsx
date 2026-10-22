import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { classesContract } from '@giaokhoa/shared/http/classes';
import { examsContract } from '@giaokhoa/shared/http/exams';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { Form, redirect } from 'react-router';
import { getAccess, requireCapability } from '#features/workspace/access.server.js';
import { AssignmentFields } from '#features/workspace/assignment-fields.js';
import { assignmentInput } from '#features/workspace/assignment-input.server.js';
import { EmptyList, Feedback, Page, Panel, SubmitButton } from '#features/workspace/ui.js';
import { actionError, apiData, parseInput } from '#lib/http/data.server.js';
import type { Route } from './+types/new';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request }: Route.LoaderArgs) {
  const access = await getAccess(request);
  const classes = (await apiData(request, '/classes', classesContract.list.responses[200])).filter(
    (item) => item.status === 'active' && item.capabilities.includes('assignment:create'),
  );
  const exams = access.capabilities.includes('exam:manage_own')
    ? await apiData(request, '/exams', examsContract.list.responses[200])
    : [];
  const query = new URL(request.url).searchParams;
  const classroom = classes.find((item) => item.id === query.get('classId')) ?? classes[0];
  const exam = exams.find((item) => item.id === query.get('examId')) ?? exams[0];
  const [revisions, members] = await Promise.all([
    exam
      ? apiData(request, `/exams/${exam.id}/revisions`, examsContract.listRevisions.responses[200])
      : [],
    classroom?.capabilities.includes('class:enrolment_manage')
      ? apiData(request, `/classes/${classroom.id}/members`, classesContract.members.responses[200])
      : [],
  ]);
  return {
    classes,
    exams,
    classroom,
    exam,
    revisions,
    members,
    examRevisionId: query.get('examRevisionId'),
  };
}
export async function action({ request }: Route.ActionArgs) {
  try {
    const form = await request.formData();
    const body = parseInput(assignmentsContract.create.body, {
      classId: form.get('classId'),
      examRevisionId: form.get('examRevisionId'),
      ...assignmentInput(form),
    });
    await requireCapability(request, 'assignment:create', {
      kind: 'class',
      resourceKey: body.classId,
    });
    const assignment = await apiData(
      request,
      '/assignments',
      assignmentsContract.create.responses[201],
      { method: 'POST', data: body },
    );
    return redirect(`/assignments/${assignment.id}`);
  } catch (error) {
    return actionError(error);
  }
}
export default function NewAssignment({
  loaderData: { classes, exams, classroom, exam, revisions, members, examRevisionId },
  actionData,
}: Route.ComponentProps) {
  return (
    <Page
      title="Giao bài mới"
      description="Chọn lớp và phiên bản đề đã chốt, thiết lập lịch rồi lưu bản nháp."
    >
      <Feedback {...actionData} />
      {!classes.length || !exams.length ? (
        <EmptyList>Cần một lớp có quyền giao bài và một đề thi của bạn để tiếp tục.</EmptyList>
      ) : (
        <>
          <Panel title="Chọn lớp và đề">
            <Form method="get">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="classId">Lớp học</FieldLabel>
                  <NativeSelect
                    name="classId"
                    id="classId"
                    defaultValue={classroom?.id}
                    key={classroom?.id}
                  >
                    {classes.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="examId">Đề thi</FieldLabel>
                  <NativeSelect name="examId" id="examId" defaultValue={exam?.id} key={exam?.id}>
                    {exams.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.title}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <SubmitButton variant="outline">Tải phiên bản và thành viên</SubmitButton>
              </FieldGroup>
            </Form>
          </Panel>
          <Panel title={`Cấu hình bài giao · ${classroom?.name} · ${exam?.title}`}>
            {!revisions.length ? (
              <EmptyList>Đề chưa có phiên bản đã chốt.</EmptyList>
            ) : (
              <Form method="post" key={`${classroom?.id}-${exam?.id}`}>
                <input type="hidden" name="classId" value={classroom?.id} />
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="examRevisionId">Phiên bản đề</FieldLabel>
                    <NativeSelect
                      name="examRevisionId"
                      id="examRevisionId"
                      defaultValue={
                        revisions.some((item) => item.id === examRevisionId)
                          ? examRevisionId!
                          : revisions.at(-1)?.id
                      }
                    >
                      {revisions.map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          Phiên bản {item.revision} · {item.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <AssignmentFields members={members} />
                  <SubmitButton>Lưu bản nháp</SubmitButton>
                </FieldGroup>
              </Form>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
