import { Link, useRouteLoaderData } from 'react-router';
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  ClipboardListIcon,
  FilesIcon,
  LibraryIcon,
  UsersIcon,
  ShieldCheckIcon,
  NotebookPenIcon,
} from 'lucide-react';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import { Page } from '#features/workspace/ui.js';
import { workspacePermissions } from '#features/workspace/access.js';
import { formatDate } from '#lib/http/dates.js';
import type { loader } from './dashboard/layout';

export default function Home() {
  const { access, classes, assignments } =
    useRouteLoaderData<typeof loader>('routes/dashboard/layout')!;
  const permissions = workspacePermissions(access.capabilities, classes, assignments);
  const upcoming = assignments
    .filter(
      (item) =>
        item.status === 'published' &&
        item.closeAt.getTime() > Date.now() &&
        item.closeAt.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000,
    )
    .sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime())
    .slice(0, 5);
  const drafts = assignments.filter((item) => item.status === 'draft').slice(0, 3);
  const items = [
    {
      title: 'Ngân hàng câu hỏi',
      description: 'Biên soạn và quản lý phiên bản câu hỏi của bạn.',
      to: '/questions',
      icon: LibraryIcon,
      show: permissions.questions,
    },
    {
      title: 'Đề thi',
      description: 'Chọn câu hỏi sẵn sàng và chốt phiên bản để giao bài.',
      to: '/exams',
      icon: FilesIcon,
      show: permissions.exams,
    },
    {
      title: 'Lớp học',
      description: 'Tham gia lớp, quản lý thành viên và tổ chức việc học.',
      to: '/classes',
      icon: UsersIcon,
      show: permissions.classes,
    },
    {
      title: 'Bài giao',
      description: 'Theo dõi lịch làm bài, người nhận và bài cần chấm.',
      to: '/assignments',
      icon: ClipboardListIcon,
      show: permissions.assignments,
    },
    {
      title: 'Bài làm của tôi',
      description: 'Tiếp tục bài đang làm và xem kết quả được công bố.',
      to: '/attempts',
      icon: NotebookPenIcon,
      show: permissions.attempts,
    },
    {
      title: 'Chương trình học',
      description: 'Quản lý môn học và cấu trúc chương trình.',
      to: '/curricula',
      icon: BookOpenTextIcon,
      show: permissions.curriculum,
    },
    {
      title: 'Phân quyền',
      description: 'Quản lý việc cấp vai trò và quyền hệ thống.',
      to: '/authorization',
      icon: ShieldCheckIcon,
      show: permissions.authorization,
    },
  ].filter((item) => item.show);
  return (
    <Page
      title={`Chào ${access.user.name || 'bạn'}`}
      description="Không gian dạy và học của bạn tại Giáo khoa."
    >
      {(upcoming.length > 0 || drafts.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Việc cần theo dõi</CardTitle>
            <CardDescription>Bài sắp đến hạn và bài giao chưa xuất bản.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {upcoming.map((item) => (
                <div key={item.id}>
                  <Link className="underline underline-offset-4" to={'/assignments/' + item.id}>
                    {item.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {item.className} · Hạn {formatDate(item.closeAt)}
                  </p>
                </div>
              ))}
              {drafts.map((item) => (
                <div key={item.id}>
                  <Link className="underline underline-offset-4" to={'/assignments/' + item.id}>
                    {item.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {item.className} · Bản nháp chưa công bố
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.to}>
            <CardHeader>
              <item.icon className="mb-3 size-6 text-muted-foreground" />
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            {(item.to === '/classes' || item.to === '/assignments') && (
              <CardContent>
                {item.to === '/classes'
                  ? `${classes.length} lớp có quyền truy cập`
                  : `${assignments.length} bài giao có quyền truy cập`}
              </CardContent>
            )}
            <CardFooter className="mt-auto">
              <Button variant="outline" nativeButton={false} render={<Link to={item.to} />}>
                Mở {item.title.toLocaleLowerCase('vi-VN')}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </Page>
  );
}
