import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
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
import { requireSession } from '#features/auth/api/session.server.js';
import { EmptyList, Page, Panel, Status } from '#features/workspace/ui.js';
import { apiData } from '#lib/http/data.server.js';
import { formatDate } from '#lib/http/dates.js';
import type { Route } from './+types/index';
export { WorkspaceErrorBoundary as ErrorBoundary } from '#features/workspace/ui.js';
export async function loader({ request }: Route.LoaderArgs) {
  await requireSession(request);
  const [attempts, assignments] = await Promise.all([
    apiData(request, '/attempts', attemptsContract.listOwn.responses[200]),
    apiData(request, '/assignments', assignmentsContract.list.responses[200]),
  ]);
  return { attempts: attempts.reverse(), assignments };
}
export default function Attempts({ loaderData: { attempts, assignments } }: Route.ComponentProps) {
  return (
    <Page
      title="Bài làm của tôi"
      description="Tiếp tục bài đang làm hoặc xem kết quả sau khi được công bố."
    >
      <Panel title="Lịch sử làm bài">
        {!attempts.length ? (
          <EmptyList>Chọn một bài được giao để bắt đầu.</EmptyList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bài giao</TableHead>
                <TableHead>Lượt</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Bắt đầu</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {assignments.find((assignment) => assignment.id === item.assignmentId)?.title ??
                      'Bài giao'}
                  </TableCell>
                  <TableCell>{item.attemptNumber}</TableCell>
                  <TableCell>
                    <Status value={item.status} />
                  </TableCell>
                  <TableCell>{formatDate(item.startedAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link to={`/attempts/${item.id}`} />}
                    >
                      {item.status === 'in_progress' ? 'Tiếp tục' : 'Xem bài làm'}
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
