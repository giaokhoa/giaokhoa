import * as React from 'react';
import {
  IconAward,
  IconBell,
  IconBook,
  IconBuildingCommunity,
  IconCalendar,
  IconChartBar,
  IconDatabase,
  IconHelpCircle,
  IconInnerShadowTop,
  IconLayoutDashboard,
  IconMail,
  IconNotebook,
  IconQuestionMark,
  IconReport,
  IconSettings,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { NavMain, type NavEntry } from '#components/nav-main';
import { NavUser } from '#components/nav-user';
import { apiJson } from '#lib/api';
import { useNotificationUnreadStream } from '#features/notifications/hooks/notification-unread-stream';
import { queryKeys } from '#lib/query-keys';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@giaokhoa/ui/components/sidebar';
import { usePermissions } from '#lib/permissions';
import '#config/i18n';

const OPEN_GROUPS_STORAGE_KEY = 'giaokhoa:sidebar:open-groups';

function readStoredOpenGroups(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation(['app', 'dashboard']);
  const perms = usePermissions();

  useNotificationUnreadStream();
  const unreadQuery = useQuery({
    queryKey: queryKeys.notificationUnreadCount,
    queryFn: () => apiJson<{ unread: number }>('/api/v1/notifications/unread-count'),
  });
  const unreadNotifications = unreadQuery.data?.unread ?? 0;

  const messageUnreadQuery = useQuery({
    queryKey: queryKeys.messageUnreadCount,
    queryFn: () => apiJson<{ conversations: number; notifications: number }>('/api/v1/messages/unread-count'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const unreadConversations = messageUnreadQuery.data?.conversations ?? 0;

  const guardianQuery = useQuery({
    queryKey: queryKeys.guardianMyStudents,
    queryFn: () => apiJson<{ student: { id: string } }[]>('/api/v1/guardian-links/mine/students'),
  });
  const hasGuardianChildren = (guardianQuery.data?.length ?? 0) > 0;

  const [openGroups, setOpenGroups] = React.useState<string[]>(readStoredOpenGroups);
  const handleOpenGroupChange = React.useCallback((groupId: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = open ? [...new Set([...prev, groupId])] : prev.filter((id) => id !== groupId);
      try {
        window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);

  const entries: NavEntry[] = [
    { title: t('dashboard:itemDashboard'), url: '/', icon: IconLayoutDashboard },
    { title: t('app:navCourses'), url: '/courses', icon: IconBook },
    { title: t('app:navClasses'), url: '/classes', icon: IconUsers },
    { title: t('app:navCalendar'), url: '/calendar', icon: IconCalendar },
    { title: t('app:navMessages'), url: '/messages', icon: IconMail, badgeCount: unreadConversations },
    { title: t('app:navNotifications'), url: '/notifications', icon: IconBell, badgeCount: unreadNotifications },
    ...(hasGuardianChildren
      ? [{ title: t('app:navGuardian'), url: '/guardian', icon: IconUsers }]
      : []),
    ...(perms.canManageGuardians
      ? [{ title: t('app:navGuardianLinks'), url: '/admin/guardian-links', icon: IconUsers }]
      : []),
    ...(perms.hasLearnerFootprint
      ? [
          {
            groupId: 'learning',
            title: t('app:navGroupLearning'),
            icon: IconNotebook,
            children: [
              { title: t('app:navBadges'), url: '/badges', icon: IconAward },
              { title: t('app:navLearningPlan'), url: '/learning-plan', icon: IconNotebook },
            ],
          },
        ]
      : []),
    ...(perms.canUseQuestionBank
      ? [
          {
            groupId: 'my-questions',
            title: t('app:navMyQuestions'),
            icon: IconQuestionMark,
            url: '/questions',
            toggleLabel: t('app:navExpandGroup', { name: t('app:navMyQuestions') }),
            children: [
              { title: t('app:navStimuli'), url: '/questions/stimuli', icon: IconBook },
            ],
          },
          {
            groupId: 'my-papers',
            title: t('app:navMyPapers'),
            icon: IconNotebook,
            url: '/exams',
            toggleLabel: t('app:navExpandGroup', { name: t('app:navMyPapers') }),
            children: [],
          },
          {
            groupId: 'my-matrices',
            title: t('app:navMyMatrices'),
            icon: IconChartBar,
            url: '/matrices',
            toggleLabel: t('app:navExpandGroup', { name: t('app:navMyMatrices') }),
            children: [],
          },
          { title: t('app:navTeacherProgramme'), url: '/curriculum', icon: IconNotebook },
        ]
      : []),
    ...(perms.canAdminister || perms.canViewTenantAdmin
      ? [
          {
            groupId: 'users-access',
            title: t('app:navGroupUsersAccess'),
            icon: IconUsers,
            children: [
              ...(perms.canAdminister
                ? [{ title: t('app:navUsers'), url: '/admin/users', icon: IconUsers }]
                : []),
              ...(perms.canViewTenantAdmin
                ? [{ title: t('app:navTenants'), url: '/admin/tenants', icon: IconBuildingCommunity }]
                : []),
              ...(perms.canAdminister
                ? [{ title: t('app:navTokens'), url: '/tokens', icon: IconSettings }]
                : []),
            ],
          },
          ...(perms.canAdminister
            ? [
                {
                  groupId: 'roles-permissions',
                  title: t('app:navGroupRolesPermissions'),
                  icon: IconShieldLock,
                  children: [
                    { title: t('app:navRoles'), url: '/admin/roles', icon: IconShieldLock },
                    { title: t('app:navPermissions'), url: '/admin/permissions', icon: IconShieldLock },
                  ],
                },
              ]
            : []),
          ...(perms.canAdminister
            ? [
                {
                  groupId: 'system-data',
                  title: t('app:navGroupSystemData'),
                  icon: IconSettings,
                  children: [
                    { title: t('app:navSiteConfig'), url: '/admin/site-config', icon: IconSettings },
                    { title: t('app:navCurriculum'), url: '/admin/curriculum', icon: IconNotebook },
                    { title: t('app:navReports'), url: '/reports', icon: IconReport },
                    { title: t('app:navInsights'), url: '/insights', icon: IconChartBar },
                    { title: t('app:navContentBank'), url: '/content-bank', icon: IconDatabase },
                    { title: t('app:navBackup'), url: '/backup', icon: IconDatabase },
                    { title: t('app:navPrivacy'), url: '/privacy', icon: IconShieldLock },
                    { title: t('app:navHealth'), url: '/health', icon: IconHelpCircle },
                  ],
                },
              ]
            : []),
        ]
      : []),
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/" />} className="data-[slot=sidebar-menu-button]:p-1.5!">
              <IconInnerShadowTop className="size-5!" />
              <span className="text-base font-semibold">Giáo khoa</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={entries} openGroups={openGroups} onOpenGroupChange={handleOpenGroupChange} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
