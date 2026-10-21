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
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { NavMain } from '#components/nav-main.js';
import { NavUser } from '#components/nav-user.js';

const navItems = [
  {
    title: 'Tổng quan',
    url: '/',
    icon: <LayoutDashboardIcon />,
  },
  {
    title: 'Lớp học',
    url: '/classes',
    icon: <GraduationCapIcon />,
  },
  {
    title: 'Đề thi',
    url: '/exams',
    icon: <FileTextIcon />,
  },
  {
    title: 'Giao bài',
    url: '/assignments/new',
    icon: <ClipboardListIcon />,
  },
  {
    title: 'Chương trình học',
    url: '/curricula',
    icon: <BookOpenTextIcon />,
    items: [
      {
        title: 'Môn học',
        url: '/subjects',
      },
    ],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link to="/" onClick={() => isMobile && setOpenMobile(false)} />}
            >
              <BookOpenTextIcon className="size-5!" />
              <span className="text-base font-semibold">Giáo khoa</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
