import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@giaokhoa/ui/components/breadcrumb';
import { Separator } from '@giaokhoa/ui/components/separator';
import { SidebarTrigger } from '@giaokhoa/ui/components/sidebar';
import { Link, useLocation } from 'react-router';

export function SiteHeader() {
  const { pathname } = useLocation();
  const pageTitle =
    {
      '/curricula': 'Chương trình học',
      '/subjects': 'Môn học',
      '/questions/new': 'Thêm câu hỏi',
      '/questions': 'Ngân hàng câu hỏi',
      '/classes': 'Lớp học',
      '/exams': 'Đề thi',
      '/assignments': 'Bài giao',
      '/attempts': 'Bài làm của tôi',
      '/authorization': 'Phân quyền',
    }[pathname] ??
    {
      questions: 'Câu hỏi',
      classes: 'Lớp học',
      exams: 'Đề thi',
      assignments: 'Bài giao',
      attempts: 'Bài làm',
      curricula: 'Chương trình học',
    }[pathname.split('/')[1]];

  return (
    <header className="sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) md:rounded-t-xl">
      <div className="flex h-full w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <div className="relative flex min-w-0 flex-1 items-center self-stretch">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {pageTitle ? (
                  <BreadcrumbLink render={<Link to="/" />}>Tổng quan</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>Tổng quan</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {pageTitle && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div
            id="editor-toolbar-slot"
            className="pointer-events-none absolute inset-0 z-10 min-w-0 overflow-hidden"
          />
        </div>
      </div>
    </header>
  );
}
