import { attemptsContract } from '@giaokhoa/shared/http/attempts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@giaokhoa/ui/components/empty';
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
import { requestAttemptApi } from '#features/attempts/attempt-api.server.js';
import { attemptStatusLabels, formatAttemptDate } from '#features/attempts/attempt-data.js';
import { RefreshAttempt } from '#features/attempts/attempt-ui.js';
import type { Route } from './+types/attempts';

export {
  AttemptErrorBoundary as ErrorBoundary,
  AttemptLoading as HydrateFallback,
} from '#features/attempts/attempt-ui.js';

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireSession(request);
  const parsed = attemptsContract.listForTeacher.pathParams.safeParse(params);
  if (!parsed.success) throw new Response('Mã bài giao không hợp lệ.', { status: 400 });
  return {
    assignmentId: parsed.data.assignmentId,
    attempts: await requestAttemptApi(request, attemptsContract.listForTeacher, parsed.data),
  };
}

export default function AssignmentAttempts({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Lượt làm bài</h1>
        <RefreshAttempt />
      </div>
      <Link to={`/assignments/${loaderData.assignmentId}`}>Về bài giao</Link>
      <Card>
        <CardHeader>
          <CardTitle>Danh sách lượt làm</CardTitle>
          <CardDescription>
            {loaderData.attempts.length} lượt làm. Chọn một lượt để xem và chấm bài.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.attempts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Chưa có lượt làm</EmptyTitle>
                <EmptyDescription>Chưa có học sinh bắt đầu làm bài.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã học sinh</TableHead>
                  <TableHead>Lần làm</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Bắt đầu</TableHead>
                  <TableHead>Đã nộp</TableHead>
                  <TableHead>Điểm /100</TableHead>
                  <TableHead>Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaderData.attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell>
                      <code>{attempt.userId}</code>
                    </TableCell>
                    <TableCell>{attempt.attemptNumber}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{attemptStatusLabels[attempt.status]}</Badge>
                    </TableCell>
                    <TableCell>{formatAttemptDate(attempt.startedAt)}</TableCell>
                    <TableCell>{formatAttemptDate(attempt.submittedAt)}</TableCell>
                    <TableCell>{attempt.score ?? 'Chưa chấm'}</TableCell>
                    <TableCell>
                      <Link
                        to={`/attempts/${attempt.id}/review`}
                        aria-label={`Xem lượt ${attempt.attemptNumber} của học sinh ${attempt.userId}`}
                      >
                        Xem và chấm
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
