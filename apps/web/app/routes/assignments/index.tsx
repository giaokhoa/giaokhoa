import { assignmentsContract } from '@giaokhoa/shared/http/assignments';
import { classesContract } from '@giaokhoa/shared/http/classes';
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
  const [assignments, classes] = await Promise.all([
    apiData(request, '/assignments', assignmentsContract.list.responses[200]),
    apiData(request, '/classes', classesContract.list.responses[200]),
  ]);
  return {
    assignments,
    canCreate: classes.some(
      (item) => item.status === 'active' && item.capabilities.includes('assignment:create'),
    ),
  };
}
export default function Assignments({
  loaderData: { assignments, canCreate },
}: Route.ComponentProps) {
  return (
    <Page
      title="Bài giao"
      description="Lịch làm bài và bài giao bạn được phép truy cập."
      actions={
        canCreate && (
          <Button nativeButton={false} render={<Link to="/assignments/new" />}>
            Giao bài mới
          </Button>
        )
      }
    >
      <Panel title="Danh sách bài giao">
        {!assignments.length ? (
          <EmptyList>Bài được giao hoặc bài bạn quản lý sẽ xuất hiện tại đây.</EmptyList>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Đề thi</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Mở / đóng bài</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.title}</TableCell>
                  <TableCell>{item.className}</TableCell>
                  <TableCell>
                    <Status value={item.status} />
                  </TableCell>
                  <TableCell>
                    {formatDate(item.openAt)}
                    <br />
                    {formatDate(item.closeAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={`/assignments/${item.id}`} />}
                      >
                        Chi tiết
                      </Button>
                      {item.capabilities.includes('assignment:grade') && (
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link to={`/assignments/${item.id}/attempts`} />}
                        >
                          Chấm bài
                        </Button>
                      )}
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
