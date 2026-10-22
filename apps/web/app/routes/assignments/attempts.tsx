import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Link } from 'react-router';
import { requireCapability } from '#features/workspace/access.server.js';
import { EmptyList, Page, Panel, Status } from '#features/workspace/ui.js';
import { apiData, routeId } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/attempts';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request, params }: Route.LoaderArgs) {
  const id = routeId(params.id, assignmentsContract.get.pathParams);
  await requireCapability(request, 'assignment:grade', { kind: 'assignment', resourceKey: id });
  return {
    attempts: await apiData(
      request,
      `/assignments/${id}/attempts`,
      attemptsContract.listForTeacher.responses[200],
    ),
  };
}
export default function AssignmentAttempts({ loaderData: { attempts } }: Route.ComponentProps) {
  return (
    <Page
      title="Bài làm của học sinh"
      description="Xem câu trả lời, chấm điểm và nhận xét những lượt đã nộp."
    >
      <Panel title="Danh sách lượt làm">
        {!attempts.length ? (
          <EmptyList>Chưa có lượt làm nào.</EmptyList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Người học</TableHead>
                <TableHead>Lượt</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Nộp lúc</TableHead>
                <TableHead>Điểm</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.userId}</TableCell>
                  <TableCell>{item.attemptNumber}</TableCell>
                  <TableCell>
                    <Status value={item.status} />
                  </TableCell>
                  <TableCell>{formatDate(item.submittedAt)}</TableCell>
                  <TableCell>{item.score ?? 'Chưa chấm'}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link to={`/attempts/${item.id}/review`} />}
                    >
                      Xem và chấm
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
