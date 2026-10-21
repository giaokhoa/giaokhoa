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
import { authClient } from '#features/auth/api/auth-client.js';
import { NavUser } from '#components/nav-user.js';

type NavEntry = {
  title: string;
  url: string;
  icon: React.ReactNode;
  teacherOnly?: boolean;
  items?: { title: string; url: string }[];
};

const navItems: NavEntry[] = [
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
    teacherOnly: true,
    icon: <FileTextIcon />,
  },
  {
    title: 'Giao bài',
    url: '/assignments/new',
    teacherOnly: true,
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
  const { data: session } = authClient.useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canTeach = role === 'teacher' || role === 'admin';
  const items = navItems.filter((item) => !item.teacherOnly || canTeach);

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
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
