/**
 * Bảng lệnh tìm kiếm hợp nhất trong header, mở bằng Cmd+K / Ctrl+K: một ô gõ cho ra
 * nhóm "Đi tới" (màn hình theo quyền và khoá học của tôi, lọc không dấu tại client)
 * và nhóm "Nội dung" (gọi GET /api/v1/search sau debounce 250 ms, mở đích theo
 * ánh xạ dùng chung ở lib/search-target). Điều hướng bằng mũi tên + Enter trên
 * một danh sách phẳng theo đúng thứ tự hiển thị.
 */

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

/**
 * Một đích đến trong bề mặt tìm kiếm: mục đi tới (màn hình theo quyền hoặc khoá học của tôi) hoặc một kết quả nội dung từ tìm kiếm toàn cục.
 */
interface PaletteItem {
  id: string;
  title: string;
  hint?: string;
  url: string;
  group: 'goto' | 'content';
}

/**
 * Bỏ dấu tiếng Việt + hạ chữ thường để khớp tìm kiếm không dấu: người dùng gõ "khoa hoc" vẫn ra "Khoá học", gõ "tin nhan" ra "Tin nhắn".
 */
function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Khoá nhãn loại kết quả nội dung theo `area` của API tìm kiếm (gợi ý bên phải mỗi kết quả). Chỉ ba area đã có đích ở lib/search-target mới có nhãn; kết quả thuộc area lạ đã bị loại trước khi tới đây.
 */
const CONTENT_AREA_LABEL_KEYS: Record<string, string> = {
  courses: 'platform:searchAreaCourses',
  users: 'platform:searchAreaUsers',
  contentbank: 'platform:searchAreaContentBank',
};

/**
 * Bề mặt tìm kiếm hợp nhất của header, mở bằng Cmd+K / Ctrl+K từ mọi trang của khu vực đã đăng nhập (chuẩn app hiện đại — Linear, Notion, GitHub). Chủ repo chốt gộp hai bề mặt tìm kiếm cũ thành một (ngày 27/10/2026): nút "Tìm nhanh…" riêng ở vùng phải header đã BỎ — bề mặt này chỉ còn mở bằng phím tắt; ô tìm kiếm ở giữa header giữ nguyên vai trò đường vào trang kết quả đầy đủ `/search`. Một ô gõ duy nhất cho ra hai nhóm kết quả:
 *
 * - Nhóm "Đi tới": màn hình theo quyền + khoá học của tôi, lọc chữ
 *   tại client và Enter/nhấp là đi thẳng. Tôn trọng quyền theo đúng cây sidebar: danh sách màn hình dựng từ CÙNG các cổng của AppSidebar (canUseQuestionBank cho Ngân hàng câu hỏi, canAdminister cho nhóm quản trị, hasLearnerFootprint cho Huy hiệu/Kế hoạch học tập theo issue #176) và khoá học lấy từ ảnh chụp quyền (perms.courses — API /courses đã tự lọc theo người xem). Mục không có quyền thì KHÔNG xuất hiện. Mục "Tìm kiếm" trỏ `/search` trần của bảng lệnh cũ đã bỏ: trang kết quả nay là một trong các đích của chính nhóm nội dung và của ô giữa header, không còn là một mục điều hướng riêng.
 * - Nhóm "Nội dung": gọi GET /api/v1/search bằng từ khoá đã gỡ
 *   debounce 250 ms (tránh bắn API theo từng phím); server đã lọc kết quả theo quyền của người tìm. Mỗi kết quả mở được item đích theo ánh xạ dùng chung ở lib/search-target (cùng ánh xạ với trang `/search`); kết quả thuộc area chưa có route đích thì không vào danh sách chọn được. Riêng kết quả `users`: mọi vai trò đều nhận được từ API nhưng đích duy nhất là màn quản trị người dùng, nên chỉ vào danh sách khi ảnh chụp quyền của người đang tìm có quyền quản trị người dùng (site admin hoặc `user:update` tại context hệ thống — capability màn đích tự gác); vai trò còn lại không thấy chúng trong danh sách chọn, tránh điều hướng vào màn quản trị mình không có quyền dùng.
 *
 * Điều hướng bàn phím (mũi tên + Enter) chạy trên MỘT danh sách phẳng theo đúng thứ tự hiển thị: nhóm Đi tới trước, nhóm Nội dung sau. Component mount một lần duy nhất trong SiteHeader (không render gì khi đang đóng) nên phím tắt sống trên mọi trang.
 */

/**
 * Một mục chọn được trong bảng lệnh — dùng chung cho nhóm "Đi tới" và nhóm "Nội dung" (trước đây hai khối `<li>` chép lại nhau,
 * chỉ khác cách tính chỉ số phẳng cho điều hướng bàn phím).
 */
function PaletteOption({
  item,
  index,
  activeIndex,
  onHover,
  onSelect,
}: {
  /** Mục cần hiện. */
  item: PaletteItem;
  /** Chỉ số phẳng trong danh sách điều hướng (nhóm Đi tới trước, nhóm Nội dung sau). */
  index: number;
  /** Chỉ số mục đang chọn bằng bàn phím. */
  activeIndex: number;
  /** Di chuột vào mục (đặt làm mục đang chọn). */
  onHover: (index: number) => void;
  /** Chọn mục (điều hướng). */
  onSelect: (item: PaletteItem) => void;
}) {
  return (
    <li
      role="option"
      aria-selected={index === activeIndex}
      data-index={index}
      data-testid={`palette-item-${item.id}`}
      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        index === activeIndex ? 'bg-accent text-accent-foreground' : ''
      }`}
      onMouseEnter={() => onHover(index)}
      onClick={() => onSelect(item)}
    >
      <span className="truncate">{item.title}</span>
      {item.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span> : null}
    </li>
  );
}

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
            { id: 'screen-badges', title: t('app:navBadges'), url: '/badges', group: 'goto' as const },
            { id: 'screen-learning-plan', title: t('app:navLearningPlan'), url: '/learning-plan', group: 'goto' as const },
          ])
        : []),
      ...(perms.canUseQuestionBank
        ? [{ id: 'screen-questions', title: t('app:navQuestions'), url: '/questions', group: 'goto' as const }]
        : []),
      ...(perms.canAdminister
        ? ([
            { id: 'screen-admin-users', title: t('app:navUsers'), url: '/admin/users', group: 'goto' as const },
            { id: 'screen-admin-roles', title: t('app:navRoles'), url: '/admin/roles', group: 'goto' as const },
            { id: 'screen-tokens', title: t('app:navTokens'), url: '/tokens', group: 'goto' as const },
            { id: 'screen-site-config', title: t('app:navSiteConfig'), url: '/admin/site-config', group: 'goto' as const },
            { id: 'screen-reports', title: t('app:navReports'), url: '/reports', group: 'goto' as const },
            { id: 'screen-insights', title: t('app:navInsights'), url: '/insights', group: 'goto' as const },
            { id: 'screen-contentbank', title: t('app:navContentBank'), url: '/content-bank', group: 'goto' as const },
            { id: 'screen-backup', title: t('app:navBackup'), url: '/backup', group: 'goto' as const },
            { id: 'screen-privacy', title: t('app:navPrivacy'), url: '/privacy', group: 'goto' as const },
            { id: 'screen-health', title: t('app:navHealth'), url: '/health', group: 'goto' as const },
          ])
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

  // Gỡ debounce từ khoá cho nhóm Nội dung: chỉ khi chữ đã yên 250 ms
  // mới coi là từ khoá tìm nội dung, tránh gọi API theo từng phím.
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

  // Quyền quản trị người dùng của chính người đang tìm, suy từ
  // ảnh chụp quyền: điều kiện duy nhất để kết quả `users` có đích
  // (màn quản trị tự gác `user:update`). Ảnh chụp chưa tải được
  // thì coi như không có quyền — kết quả `users` không vào danh
  // sách, đúng chiều an toàn của ánh xạ.
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

  // Danh sách phẳng cho điều hướng bàn phím, đúng thứ tự hiển thị.
  const navigable = useMemo(() => [...filteredGoto, ...contentItems], [filteredGoto, contentItems]);
  const contentPending = debouncedQuery.length > 0 && contentQuery.data === undefined && contentQuery.isFetching;
  const contentFailed = debouncedQuery.length > 0 && contentQuery.isError;

  // Mở bằng Cmd+K (macOS) / Ctrl+K (Windows/Linux) từ bất kỳ trang nào;
  // bấm lại khi đang mở thì đóng (toggle như các app chuẩn).
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

  // Dồn focus vào ô tìm khi bảng lệnh mở, không reset state trong effect.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Giữ mục đang chọn luôn trong tầm mắt khi di chuyển bằng phím.
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
                <PaletteOption
                  key={item.id}
                  item={item}
                  index={index}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                  onSelect={go}
                />
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
              {contentItems.map((item, offset) => (
                <PaletteOption
                  key={item.id}
                  item={item}
                  index={filteredGoto.length + offset}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                  onSelect={go}
                />
              ))}
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
