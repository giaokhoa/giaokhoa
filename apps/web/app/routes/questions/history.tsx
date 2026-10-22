import { questionsContract } from '@giaokhoa/shared/http/questions';
import { Button } from '@giaokhoa/ui/components/button';
import { Link } from 'react-router';
import { requireCapability } from '#features/workspace/access.server.js';
import { QuestionPreview } from '#features/workspace/question-preview.js';
import { Page, Panel, Status } from '#features/workspace/ui.js';
import { apiData, parseInput, routeId } from '#lib/http/data.server.js';
import type { Route } from './+types/history';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCapability(request, 'question:manage_own');
  const id = routeId(params.id, questionsContract.get.pathParams);
  const versions = await apiData(
    request,
    `/questions/${id}/versions`,
    questionsContract.listVersions.responses[200],
  );
  const selected = new URL(request.url).searchParams.get('version');
  const path = selected
    ? `/questions/${id}/versions/${parseInput(questionsContract.getVersion.pathParams, { id, version: selected }).version}`
    : `/questions/${id}`;
  return {
    id,
    versions,
    question: await apiData(request, path, questionsContract.get.responses[200]),
  };
}
export default function History({ loaderData: { id, versions, question } }: Route.ComponentProps) {
  return (
    <Page
      title="Lịch sử câu hỏi"
      description="Mỗi phiên bản giữ nguyên nội dung đã lưu."
      actions={
        <Button variant="outline" nativeButton={false} render={<Link to={`/questions/${id}`} />}>
          Sửa bản mới nhất
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {versions.map((item) => (
          <Button
            key={item.version}
            variant={item.version === question.version ? 'default' : 'outline'}
            nativeButton={false}
            render={<Link to={`?version=${item.version}`} />}
          >
            Phiên bản {item.version}
          </Button>
        ))}
      </div>
      <Panel title={`Phiên bản ${question.version}`}>
        <div className="flex flex-col gap-4">
          <Status value={question.status} />
          <QuestionPreview question={question} />
        </div>
      </Panel>
    </Page>
  );
}
