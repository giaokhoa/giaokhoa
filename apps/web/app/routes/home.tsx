import { Button } from '@giaokhoa/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giaokhoa/ui/components/card';
import {
  BookOpenTextIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  PlusIcon,
} from 'lucide-react';
import type { ElementType } from 'react';
import { Link } from 'react-router';
import { authClient } from '#features/auth/api/auth-client.js';

type Workflow = {
  title: string;
  description: string;
  url: string;
  icon: ElementType;
  action: string;
  teacherOnly?: boolean;
};

const workflows: Workflow[] = [
  {
    title: 'Lớp học',
    description: 'Tạo lớp, tham gia bằng mã, quản lý thành viên và lời mời.',
    url: '/classes',
    icon: GraduationCapIcon,
    action: 'Quản lý lớp',
  },
  {
    title: 'Đề thi',
    teacherOnly: true,
    description: 'Soạn đề và chốt phiên bản câu hỏi để sử dụng khi giao bài.',
    url: '/exams',
    icon: FileTextIcon,
    action: 'Xem đề thi',
  },
  {
    title: 'Giao bài',
    teacherOnly: true,
    description: 'Thiết lập thời gian, người nhận và lịch công bố kết quả.',
    url: '/assignments/new',
    icon: ClipboardListIcon,
    action: 'Tạo bài giao',
  },
  {
    title: 'Chương trình học',
    description: 'Tra cứu môn học và chương trình học theo từng khối lớp.',
    url: '/curricula',
    icon: BookOpenTextIcon,
    action: 'Xem chương trình',
  },
];

export default function Home() {
  const { data: session } = authClient.useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canTeach = role === 'teacher' || role === 'admin';
  const visibleWorkflows = workflows.filter((workflow) => !workflow.teacherOnly || canTeach);

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tổng quan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quản lý nội dung dạy học, lớp, đề thi và bài được giao.
          </p>
        </div>
        {canTeach && (
          <Button render={<Link to="/questions/new" />}>
            <PlusIcon data-icon="inline-start" />
            Thêm câu hỏi
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {visibleWorkflows.map(({ title, description, url, icon: Icon, action }) => (
          <Card key={url}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon className="size-5 text-muted-foreground" />
                <CardTitle>{title}</CardTitle>
              </div>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" render={<Link to={url} />}>
                {action}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
