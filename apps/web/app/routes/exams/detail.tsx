import { examsContract } from '@giaokhoa/shared/http/exams';
import { questionsContract } from '@giaokhoa/shared/http/questions';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@giaokhoa/ui/components/field';
import { Form, Link } from 'react-router';
import { getAccess, requireCapability } from '#features/workspace/access.server.js';
import {
  QuestionPreview,
  questionText,
  questionTypeLabels,
} from '#features/workspace/question-preview.js';
import {
  EmptyList,
  Feedback,
  InputField,
  Page,
  Panel,
  SubmitButton,
} from '#features/workspace/ui.js';
import { actionError, apiData, parseInput, routeId } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/detail';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCapability(request, 'exam:manage_own');
  const id = routeId(params.id, examsContract.get.pathParams);
  const access = await getAccess(request);
  const [exam, revisions, questions] = await Promise.all([
    apiData(request, `/exams/${id}`, examsContract.get.responses[200]),
    apiData(request, `/exams/${id}/revisions`, examsContract.listRevisions.responses[200]),
    access.capabilities.includes('question:manage_own')
      ? apiData(request, '/questions', questionsContract.list.responses[200])
      : [],
  ]);
  const selected = new URL(request.url).searchParams.get('revision');
  const number = selected
    ? parseInput(examsContract.getRevision.pathParams, { id, revision: selected }).revision
    : revisions.at(-1)?.revision;
  const revision = number
    ? await apiData(
        request,
        `/exams/${id}/revisions/${number}`,
        examsContract.getRevision.responses[200],
      )
    : null;
  return {
    exam,
    revisions,
    revision,
    questions: questions.filter((item) => item.status === 'ready'),
  };
}
export async function action({ request, params }: Route.ActionArgs) {
  try {
    await requireCapability(request, 'exam:manage_own');
    const id = routeId(params.id, examsContract.get.pathParams);
    const form = await request.formData();
    if (form.get('intent') === 'update') {
      const body = parseInput(examsContract.update.body, { title: form.get('title') });
      await apiData(request, `/exams/${id}`, examsContract.update.responses[200], {
        method: 'PATCH',
        data: body,
      });
    } else if (form.get('intent') === 'revision') {
      const questions = form.getAll('question').map((value) => {
        try {
          return JSON.parse(typeof value === 'string' ? value : '');
        } catch {
          throw new Response('Câu hỏi không hợp lệ.', { status: 400 });
        }
      });
      const body = parseInput(examsContract.createRevision.body, { questions });
      await apiData(
        request,
        `/exams/${id}/revisions`,
        examsContract.createRevision.responses[201],
        { method: 'POST', data: body },
      );
    } else throw new Response('Thao tác không hợp lệ.', { status: 400 });
    return { success: 'Đã lưu đề thi.' };
  } catch (error) {
    return actionError(error);
  }
}
export default function ExamDetail({
  loaderData: { exam, revisions, revision, questions },
  actionData,
}: Route.ComponentProps) {
  return (
    <Page
      title={exam.title}
      description="Phiên bản đã chốt giữ nguyên nội dung ngay cả khi câu hỏi được sửa sau này."
    >
      <Feedback {...actionData} />
      <Panel title="Thông tin đề">
        <Form method="post">
          <input type="hidden" name="intent" value="update" />
          <FieldGroup>
            <InputField
              name="title"
              label="Tên đề"
              defaultValue={exam.title}
              required
              maxLength={200}
            />
            <SubmitButton>Lưu tên đề</SubmitButton>
          </FieldGroup>
        </Form>
      </Panel>
      <Panel
        title="Chốt phiên bản mới"
        description="Chọn từ 1 đến 100 câu hỏi sẵn sàng. Thứ tự bên dưới là thứ tự câu trong đề."
      >
        {!questions.length ? (
          <EmptyList>
            Chưa có câu hỏi sẵn sàng. Hãy hoàn thiện câu hỏi trong ngân hàng trước.
          </EmptyList>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="revision" />
            <FieldGroup>
              <FieldSet>
                <FieldLegend>Câu hỏi của bạn</FieldLegend>
                <FieldGroup>
                  {questions.map((item) => (
                    <Field key={item.id} orientation="horizontal">
                      <input
                        id={`q-${item.id}`}
                        type="checkbox"
                        name="question"
                        value={JSON.stringify({ questionId: item.id, version: item.version })}
                      />
                      <FieldLabel htmlFor={`q-${item.id}`}>
                        {questionTypeLabels[item.type]} · Phiên bản {item.version} ·{' '}
                        {questionText(item.content)}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
              <SubmitButton>Chốt phiên bản đề</SubmitButton>
            </FieldGroup>
          </Form>
        )}
      </Panel>
      <Panel title="Phiên bản đã chốt">
        {!revisions.length ? (
          <EmptyList />
        ) : (
          <div className="flex flex-wrap gap-2">
            {revisions.map((item) => (
              <Button
                variant={item.revision === revision?.revision ? 'default' : 'outline'}
                key={item.id}
                nativeButton={false}
                render={<Link to={`?revision=${item.revision}`} />}
              >
                Phiên bản {item.revision} · {formatDate(item.createdAt)}
              </Button>
            ))}
          </div>
        )}
      </Panel>
      {revision && (
        <Panel title={`Nội dung phiên bản ${revision.revision}`}>
          <div className="flex flex-col gap-6">
            {revision.questions.map((item) => (
              <section key={item.position}>
                <h2 className="mb-3 font-medium">Câu {item.position}</h2>
                <QuestionPreview question={item.question} />
              </section>
            ))}
            <Button
              nativeButton={false}
              render={
                <Link to={`/assignments/new?examId=${exam.id}&examRevisionId=${revision.id}`} />
              }
            >
              Giao phiên bản này
            </Button>
          </div>
        </Panel>
      )}
    </Page>
  );
}
