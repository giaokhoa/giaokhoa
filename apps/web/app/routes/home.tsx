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
import { Link } from 'react-router';

const workflows = [
  {
    title: 'Lớp học',
    description: 'Tạo lớp, tham gia bằng mã, quản lý thành viên và lời mời.',
    url: '/classes',
    icon: GraduationCapIcon,
    action: 'Quản lý lớp',
  },
  {
    title: 'Đề thi',
    description: 'Soạn đề và chốt phiên bản câu hỏi để sử dụng khi giao bài.',
    url: '/exams',
    icon: FileTextIcon,
    action: 'Xem đề thi',
  },
  {
    title: 'Giao bài',
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
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tổng quan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quản lý nội dung dạy học, lớp, đề thi và bài được giao.
          </p>
        </div>
        <Button render={<Link to="/questions/new" />}>
          <PlusIcon data-icon="inline-start" />
          Thêm câu hỏi
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {workflows.map(({ title, description, url, icon: Icon, action }) => (
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
