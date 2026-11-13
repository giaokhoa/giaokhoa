import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { IconSearch } from '@tabler/icons-react';
import { apiJson } from '#lib/api';
import { systemCapabilities, usePermissions } from '#lib/permissions';
import { queryKeys } from '#lib/query-keys';
import { globalSearchTarget, type GlobalSearchDoc } from '#lib/search-target';
import '#config/i18n';

interface PaletteItem {
  id: string;
  title: string;
  hint?: string;
  url: string;
  group: 'goto' | 'content';
}

function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const CONTENT_AREA_LABEL_KEYS: Record<string, string> = {
  courses: 'platform:searchAreaCourses',
  users: 'platform:searchAreaUsers',
  contentbank: 'platform:searchAreaContentBank',
};

export function CommandPalette() {
  const { t } = useTranslation(['app', 'dashboard', 'platform']);
  const perms = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const gotoItems = useMemo<PaletteItem[]>(() => {
    const screens: PaletteItem[] = [
      { id: 'screen-dashboard', title: t('dashboard:itemDashboard'), url: '/', group: 'goto' },
      { id: 'screen-courses', title: t('app:navCourses'), url: '/courses', group: 'goto' },
      { id: 'screen-calendar', title: t('app:navCalendar'), url: '/calendar', group: 'goto' },
      { id: 'screen-messages', title: t('app:navMessages'), url: '/messages', group: 'goto' },
      { id: 'screen-notifications', title: t('app:navNotifications'), url: '/notifications', group: 'goto' },
      { id: 'screen-profile', title: t('app:navProfile'), url: '/profile', group: 'goto' },
      { id: 'screen-settings', title: t('app:navSettings'), url: '/settings', group: 'goto' },
      ...(perms.hasLearnerFootprint
        ? ([
            { id: 'screen-badges', title: t('app:navBadges'), url: '/badges', group: 'goto' },
            { id: 'screen-learning-plan', title: t('app:navLearningPlan'), url: '/learning-plan', group: 'goto' },
          ] as PaletteItem[])
        : []),
      ...(perms.canUseQuestionBank
        ? [{ id: 'screen-questions', title: t('app:navQuestions'), url: '/questions', group: 'goto' } as PaletteItem]
        : []),
      ...(perms.canAdminister
        ? ([
            { id: 'screen-admin-users', title: t('app:navUsers'), url: '/admin/users', group: 'goto' },
            { id: 'screen-admin-roles', title: t('app:navRoles'), url: '/admin/roles', group: 'goto' },
            { id: 'screen-tokens', title: t('app:navTokens'), url: '/tokens', group: 'goto' },
            { id: 'screen-site-config', title: t('app:navSiteConfig'), url: '/admin/site-config', group: 'goto' },
            { id: 'screen-reports', title: t('app:navReports'), url: '/reports', group: 'goto' },
            { id: 'screen-insights', title: t('app:navInsights'), url: '/insights', group: 'goto' },
            { id: 'screen-contentbank', title: t('app:navContentBank'), url: '/content-bank', group: 'goto' },
            { id: 'screen-backup', title: t('app:navBackup'), url: '/backup', group: 'goto' },
            { id: 'screen-privacy', title: t('app:navPrivacy'), url: '/privacy', group: 'goto' },
            { id: 'screen-health', title: t('app:navHealth'), url: '/health', group: 'goto' },
          ] as PaletteItem[])
        : []),
    ];
    const courses: PaletteItem[] = perms.courses.map((c) => ({
      id: `course-${c.course.id}`,
      title: c.course.fullName,
      hint: c.course.shortName,
      url: `/courses/${c.course.id}`,
      group: 'goto',
    }));
    return [...screens, ...courses];
  }, [perms, t]);

  const filteredGoto = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    if (!q) return gotoItems;
    return gotoItems.filter((item) => normalizeForSearch(`${item.title} ${item.hint ?? ''}`).includes(q));
  }, [gotoItems, query]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  const contentQuery = useQuery({
    queryKey: queryKeys.globalSearch(debouncedQuery),
    queryFn: () => apiJson<GlobalSearchDoc[]>(`/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: open && debouncedQuery.length > 0,
  });

  const canManageUsers =
    (perms.access?.isSiteAdmin ?? false) ||
    (perms.access ? systemCapabilities(perms.access).includes('user:update') : false);

  const contentItems = useMemo<PaletteItem[]>(() => {
    if (!contentQuery.data) return [];
    return contentQuery.data.flatMap((doc) => {
      const url = globalSearchTarget(doc, { canManageUsers });
      const labelKey = CONTENT_AREA_LABEL_KEYS[doc.area];
      if (!url || !labelKey) return [];
      return [
        {
          id: `content-${doc.id}`,
          title: doc.title,
          hint: t(labelKey),
          url,
          group: 'content' as const,
        },
      ];
    });
  }, [contentQuery.data, t, canManageUsers]);

  const navigable = useMemo(() => [...filteredGoto, ...contentItems], [filteredGoto, contentItems]);
  const contentPending = debouncedQuery.length > 0 && contentQuery.data === undefined && contentQuery.isFetching;
  const contentFailed = debouncedQuery.length > 0 && contentQuery.isError;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        setDebouncedQuery('');
        setActiveIndex(0);
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    void navigate(item.url);
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (navigable.length ? (i + 1) % navigable.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (navigable.length ? (i - 1 + navigable.length) % navigable.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(navigable[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('app:paletteTitle')}
        data-testid="command-palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onListKeyDown}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={t('app:palettePlaceholder')}
            aria-label={t('app:paletteTitle')}
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul ref={listRef} role="listbox" aria-label={t('app:paletteTitle')} className="max-h-80 overflow-y-auto p-2">
          {filteredGoto.length ? (
            <Fragment>
              <li className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
                {t('app:paletteGoGroup')}
              </li>
              {filteredGoto.map((item, index) => (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  data-testid={`palette-item-${item.id}`}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(item)}
                >
                  <span className="truncate">{item.title}</span>
                  {item.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span> : null}
                </li>
              ))}
            </Fragment>
          ) : null}
          {contentItems.length || contentPending || contentFailed ? (
            <Fragment>
              <li className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
                {t('app:paletteContentGroup')}
              </li>
              {contentPending ? (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('app:paletteContentLoading')}</li>
              ) : null}
              {contentFailed ? (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('app:paletteContentFailed')}</li>
              ) : null}
              {contentItems.map((item, offset) => {
                const index = filteredGoto.length + offset;
                return (
                  <li
                    key={item.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-index={index}
                    data-testid={`palette-item-${item.id}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                      index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(item)}
                  >
                    <span className="truncate">{item.title}</span>
                    {item.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span> : null}
                  </li>
                );
              })}
            </Fragment>
          ) : null}
          {navigable.length === 0 && !contentPending && !contentFailed ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">{t('app:paletteEmpty')}</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
