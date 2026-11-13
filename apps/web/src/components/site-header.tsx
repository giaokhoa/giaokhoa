import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { IconSearch } from '@tabler/icons-react';

import { Input } from '@giaokhoa/ui/components/input';
import { Separator } from '@giaokhoa/ui/components/separator';
import { SidebarTrigger } from '@giaokhoa/ui/components/sidebar';
import { CommandPalette } from '#components/command-palette';
import { NotificationBell } from '#features/notifications/components/notification-bell';
import '#config/i18n';

const TITLE_KEYS: { prefix: string; key: string; ns: 'app' | 'dashboard' }[] = [
  { prefix: '/admin/users', key: 'navUsers', ns: 'app' },
  { prefix: '/admin/tenants', key: 'navTenants', ns: 'app' },
  { prefix: '/admin/roles', key: 'navRoles', ns: 'app' },
  { prefix: '/admin/site-config', key: 'navSiteConfig', ns: 'app' },
  { prefix: '/courses', key: 'navCourses', ns: 'app' },
  { prefix: '/questions', key: 'navQuestions', ns: 'app' },
  { prefix: '/exams', key: 'navMyPapers', ns: 'app' },
  { prefix: '/matrices', key: 'navMyMatrices', ns: 'app' },
  { prefix: '/system-bank/questions', key: 'navQuestions', ns: 'app' },
  { prefix: '/system-bank/exams', key: 'navMyPapers', ns: 'app' },
  { prefix: '/system-bank/matrices', key: 'navMyMatrices', ns: 'app' },
  { prefix: '/question-usages', key: 'navQuestions', ns: 'app' },
  { prefix: '/messages', key: 'navMessages', ns: 'app' },
  { prefix: '/notifications', key: 'navNotifications', ns: 'app' },
  { prefix: '/guardian', key: 'navGuardian', ns: 'app' },
  { prefix: '/calendar', key: 'navCalendar', ns: 'app' },
  { prefix: '/badges', key: 'navBadges', ns: 'app' },
  { prefix: '/learning-plan', key: 'navLearningPlan', ns: 'app' },
  { prefix: '/search', key: 'navSearch', ns: 'app' },
  { prefix: '/tokens', key: 'navTokens', ns: 'app' },
  { prefix: '/backup', key: 'navBackup', ns: 'app' },
  { prefix: '/insights', key: 'navInsights', ns: 'app' },
  { prefix: '/reports', key: 'navReports', ns: 'app' },
  { prefix: '/content-bank', key: 'navContentBank', ns: 'app' },
  { prefix: '/privacy', key: 'navPrivacy', ns: 'app' },
  { prefix: '/profile', key: 'navProfile', ns: 'app' },
  { prefix: '/settings', key: 'navSettings', ns: 'app' },
  { prefix: '/health', key: 'navHealth', ns: 'app' },
];

function HeaderSearch() {
  const { t } = useTranslation(['platform']);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const urlKeyword = pathname === '/search' ? (new URLSearchParams(search).get('q') ?? '') : null;
  const [keyword, setKeyword] = useState(urlKeyword ?? '');

  const [previousUrlKeyword, setPreviousUrlKeyword] = useState(urlKeyword);
  if (urlKeyword !== previousUrlKeyword) {
    setPreviousUrlKeyword(urlKeyword);
    if (urlKeyword !== null) setKeyword(urlKeyword);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = keyword.trim();
    if (!trimmed) return;
    void navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="w-full">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('platform:searchPlaceholder')}
          aria-label={t('platform:searchQuery')}
          className="rounded-full pl-9"
        />
      </div>
    </form>
  );
}

export function SiteHeader() {
  const { t } = useTranslation(['app', 'dashboard']);
  const { pathname } = useLocation();
  const match =
    pathname === '/'
      ? { key: 'itemDashboard', ns: 'dashboard' as const }
      : TITLE_KEYS.find((entry) => pathname.startsWith(entry.prefix));
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-all ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-2 pr-4 pl-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-1 lg:gap-2">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          <h1 className="truncate text-base font-medium">{match ? t(`${match.ns}:${match.key}`) : 'Giáo khoa'}</h1>
        </div>
        <div className="flex min-w-0 flex-1 justify-center px-1 lg:px-4">
          <div className="w-full max-w-xl min-w-0">
            <HeaderSearch />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 lg:gap-2">
          <CommandPalette />
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
