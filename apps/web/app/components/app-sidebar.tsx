import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@giaokhoa/ui/components/sidebar';
import {
  BookOpenTextIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  UsersIcon,
  FilesIcon,
  ClipboardListIcon,
  NotebookPenIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { NavMain } from '#components/nav-main.js';
import { NavUser } from '#components/nav-user.js';
import { workspacePermissions } from '#features/workspace/access.js';

type Props = React.ComponentProps<typeof Sidebar> & {
  capabilities: string[];
  classes: Array<{ capabilities: string[] }>;
  assignments: Array<{ capabilities: string[] }>;
};
export function AppSidebar({ capabilities, classes, assignments, ...props }: Props) {
  const { isMobile, setOpenMobile } = useSidebar();
  const permissions = workspacePermissions(capabilities, classes, assignments);
  const items = [
    { title: 'Tổng quan', url: '/', icon: <LayoutDashboardIcon />, visible: true },
    {
      title: 'Ngân hàng câu hỏi',
      url: '/questions',
      icon: <LibraryIcon />,
      visible: permissions.questions,
    },
    { title: 'Đề thi', url: '/exams', icon: <FilesIcon />, visible: permissions.exams },
    { title: 'Lớp học', url: '/classes', icon: <UsersIcon />, visible: permissions.classes },
    {
      title: 'Bài giao',
      url: '/assignments',
      icon: <ClipboardListIcon />,
      visible: permissions.assignments,
    },
    {
      title: 'Bài làm của tôi',
      url: '/attempts',
      icon: <NotebookPenIcon />,
      visible: permissions.attempts,
    },
    {
      title: 'Chương trình học',
      url: '/curricula',
      icon: <BookOpenTextIcon />,
      visible: permissions.curriculum,
      items: [{ title: 'Môn học', url: '/subjects' }],
    },
    {
      title: 'Phân quyền',
      url: '/authorization',
      icon: <ShieldCheckIcon />,
      visible: permissions.authorization,
    },
  ].filter((item) => item.visible);
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/" onClick={() => isMobile && setOpenMobile(false)} />}
            >
              <BookOpenTextIcon />
              <span>Giáo khoa</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} canCreateQuestion={permissions.createQuestion} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
