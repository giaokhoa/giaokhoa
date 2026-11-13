import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { CourseCategoryTreeNode, UserListResponse } from '@giaokhoa/contracts';
import { ApiError } from '#lib/api';
import { usePermissions } from '#lib/permissions';
import { useAccessRoles } from '#lib/access';
import { adminUsersAllQueryOptions } from '#features/admin/queries/admin-users';
import { categoryTreeQueryOptions } from '#features/courses/queries/courses';
import { formatWithOptions } from '#utils/date-format';
import { SectionCards, type StatCard } from '#components/section-cards';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ChartAreaInteractive, type ChartPoint } from './chart-area-interactive';
import { DataTable, type DataColumn } from '#components/data-table';
import { Badge } from '@giaokhoa/ui/components/badge';
import { SectionHeading } from './section-heading';
import { useDataTableLabels } from '../hooks/use-data-table-labels';

/**
 * Khối quản trị hệ thống của trang tổng quan (tách từ `dashboard.tsx`, S4):
 * lưới 4 thẻ thống kê, biểu đồ người dùng mới theo tuần và bảng người
 * dùng. Dữ liệu vào từ ba query độc lập (người dùng, cây danh mục, vai
 * trò) cộng ảnh chụp quyền; khối chỉ render khi PermissionsProvider đã
 * xác nhận người dùng có capability quản trị.
 */

/** Lỗi có phải 403 hay không — để hiện thông báo thân thiện thay vì lỗi thô. */
function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 403;
}

/** Thông báo khi một khối không tải được (kể cả 403 do quyền vừa thay đổi). */
function BlockNotice() {
  const { t } = useTranslation('dashboard');
  return <p className="px-4 text-sm text-muted-foreground lg:px-6">{t('blockForbidden')}</p>;
}

/**
 * Khối quản trị hệ thống: chỉ render khi PermissionsProvider đã xác nhận
 * người dùng có capability quản trị, và chỉ gọi các endpoint quản trị
 * (danh sách người dùng, cây danh mục, danh sách vai trò). Số liệu lấy từ
 * chính các response đó — tổng người dùng từ trường `total` của API, biểu
 * đồ gom tài khoản theo tuần tạo từ `createdAt`.
 *
 * Danh sách người dùng nạp TOÀN BỘ qua `adminUsersAllQueryOptions`
 * (`fetchAllAdminUsers` tự lật hết các trang ở cỡ trần 100 của server):
 * thẻ "đang hoạt động", biểu đồ người dùng mới theo tuần và bảng người
 * dùng đều đếm trên đủ mọi tài khoản, không chỉ 100 dòng đầu của trang
 * đầu như trước (S7 — server chặn `pageSize` tối đa 100). Footer thẻ
 * người dùng hiện luôn khi đã tải đủ, không còn điều kiện "đã tải đủ
 * trang" nữa. Khoá truy vấn nằm dưới gốc `adminUsersRoot` nên đột biến
 * người dùng vẫn làm mới được khối này.
 */
export function AdminSection() {
  const { t, i18n } = useTranslation(['dashboard', 'app']);
  const perms = usePermissions();
  const tableLabels = useDataTableLabels();
  // Ba nguồn dữ liệu của khối là ba query độc lập: TanStack Query cho
  // chúng chạy SONG SONG (trước đây nạp tuần tự trong một effect), và
  // từng thẻ/bảng tự lấp khi nguồn của nó về thay vì chờ cả khối.
  const usersQuery = useQuery(adminUsersAllQueryOptions({}));
  const treeQuery = useQuery(categoryTreeQueryOptions());
  const rolesQuery = useAccessRoles();

  const users = usersQuery.data ?? null;
  const categoryCount = useMemo(() => {
    if (!treeQuery.data) return null;
    let total = 0;
    const walk = (nodes: CourseCategoryTreeNode[]) => {
      for (const node of nodes) {
        total += 1;
        walk(node.children);
      }
    };
    walk(treeQuery.data);
    return { total, topLevel: treeQuery.data.length };
  }, [treeQuery.data]);
  const roles = rolesQuery.data ?? null;
  const failed = usersQuery.isError && isForbidden(usersQuery.error);

  // Lưới thẻ LUÔN đủ 4 ô: ô nào chưa có dữ liệu thì ở trạng thái loading
  // (giữ ô) hoặc hiện "—" khi nguồn lỗi, thay vì mọc thêm từng thẻ.
  const active = users ? users.users.filter((u) => !u.suspended && !u.deleted).length : 0;
  const cards: StatCard[] = [
    {
      id: 'admin-users',
      label: t('dashboard:statTotalUsers'),
      value: users ? String(users.total) : '—',
      footer: users ? t('dashboard:statUsersFooter', { count: active }) : undefined,
      loading: usersQuery.isPending,
    },
    {
      id: 'admin-courses',
      label: t('dashboard:statTotalCourses'),
      value: String(perms.courses.length),
      footer: t('dashboard:statCoursesFooter', {
        count: perms.courses.filter((c) => c.course.visible).length,
      }),
    },
    {
      id: 'admin-categories',
      label: t('dashboard:statTotalCategories'),
      value: categoryCount ? String(categoryCount.total) : '—',
      footer: categoryCount ? t('dashboard:statCategoriesFooter', { count: categoryCount.topLevel }) : undefined,
      loading: treeQuery.isPending,
    },
    {
      id: 'admin-roles',
      label: t('dashboard:statTotalRoles'),
      value: roles ? String(roles.length) : '—',
      footer: roles
        ? t('dashboard:statRolesFooter', {
            count: roles.filter((r) => r.archetype !== null).length,
          })
        : undefined,
      loading: rolesQuery.isPending,
    },
  ];

  const [today] = useState(() => new Date());
  const chartData: ChartPoint[] = useMemo(() => {
    if (!users) return [];
    const now = new Date(today.getTime());
    now.setHours(0, 0, 0, 0);
    return Array.from({ length: 8 }, (_, i) => {
      const start = new Date(now.getTime() - (7 - i) * 7 * 86_400_000);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const value = users.users.filter((u) => {
        const created = new Date(u.createdAt);
        return created >= start && created < end;
      }).length;
      return { label: formatWithOptions(start, i18n.language, { day: '2-digit', month: '2-digit' }), value };
    });
  }, [users, i18n.language, today]);

  const columns: DataColumn<UserListResponse['users'][number]>[] = [
    { id: 'username', header: t('app:username'), cell: (u) => u.username, sortValue: (u) => u.username },
    {
      id: 'fullName',
      header: t('dashboard:colFullName'),
      cell: (u) => `${u.firstName} ${u.lastName}`.trim(),
      sortValue: (u) => `${u.firstName} ${u.lastName}`,
    },
    { id: 'email', header: t('app:email'), cell: (u) => u.email ?? '—', sortValue: (u) => u.email ?? '' },
    {
      id: 'status',
      header: t('app:status'),
      cell: (u) =>
        u.deleted ? (
          <Badge variant="destructive">{t('app:deletedSuffix')}</Badge>
        ) : u.suspended ? (
          <Badge variant="secondary">{t('dashboard:statusSuspended')}</Badge>
        ) : (
          <Badge variant="outline">{t('dashboard:statusActive')}</Badge>
        ),
    },
  ];

  if (failed) return <BlockNotice />;
  return (
    <section className="flex flex-col gap-4 md:gap-6" data-testid="dashboard-admin">
      <SectionHeading title={t('dashboard:adminSection')} />
      <SectionCards cards={cards} />
      {usersQuery.isPending ? (
        <Skeleton className="mx-4 h-97 lg:mx-6" />
      ) : (
        <ChartAreaInteractive
          title={t('dashboard:chartAdminTitle')}
          description={t('dashboard:chartAdminDescription')}
          seriesLabel={t('dashboard:chartAdminSeries')}
          emptyText={t('dashboard:chartNoData')}
          data={chartData}
        />
      )}
      {usersQuery.isPending ? (
        <Skeleton className="mx-4 h-75 lg:mx-6" />
      ) : users ? (
        <DataTable
          title={t('dashboard:tableUsersTitle')}
          data={users.users}
          columns={columns}
          getRowId={(u) => u.id}
          labels={tableLabels}
        />
      ) : null}
    </section>
  );
}
