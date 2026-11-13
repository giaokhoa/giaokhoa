import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import type { PaginationState, SortingState } from '@tanstack/react-table';
import type { UserListSortBy, UserListStatus, UserProfile } from '@giaokhoa/contracts';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { NativeSelect, NativeSelectOption } from '@giaokhoa/ui/components/native-select';
import { Ellipsis, Plus } from 'lucide-react';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageHeader, PageShell } from '#components/page-shell';
import { SectionCards } from '#components/section-cards';
import { useAccessContexts, useAccessRoles } from '#lib/access';
import { formatDate } from '#utils/date-format';
import '#config/i18n';
import {
  adminUserStatQueryOptions,
  adminUsersAllQueryOptions,
  adminUsersListQueryOptions,
  useAdminUserDetail,
  useCreateAdminUser,
  useToggleUserSuspended,
  useUpdateAdminUser,
} from '../queries/admin-users';
import { roleHoldersQueryOptions, userAssignmentsQueryOptions } from '../queries/admin-roles';
import { UserDeleteDialog } from './user-delete-dialog';
import { DataTable, type DataColumn } from '#components/data-table';

function UserFormScreen({
  title, children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('app');
  return (
    <PageShell width="narrow">
      <PageHeader title={title} />
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
      <p>
        <Link to="/admin/users" className="text-sm underline">
          {t('backToUsersList')}
        </Link>
      </p>
    </PageShell>
  );
}

const USER_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type StatusFilterValue = '' | UserListStatus;

const SORTABLE_FIELD_IDS: readonly string[] = ['name', 'createdAt', 'lastLogin'];

export function AdminUsersPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);

  const suspendMutation = useToggleUserSuspended();

  const rolesQuery = useAccessRoles();
  const contextsQuery = useAccessContexts();
  const roles = rolesQuery.data ?? [];
  const systemContextId = contextsQuery.data?.find((c) => c.contextLevel === 10)?.id;

  const activeStatQuery = useQuery(adminUserStatQueryOptions('active'));
  const suspendedStatQuery = useQuery(adminUserStatQueryOptions('suspended'));
  const deletedStatQuery = useQuery(adminUserStatQueryOptions('deleted'));
  const statsPending = activeStatQuery.isPending || suspendedStatQuery.isPending || deletedStatQuery.isPending;
  const totalUsersCount =
    (activeStatQuery.data?.total ?? 0) + (suspendedStatQuery.data?.total ?? 0) + (deletedStatQuery.data?.total ?? 0);

  const sortEntry = sorting[0];
  const sortBy: UserListSortBy | undefined =
    sortEntry && SORTABLE_FIELD_IDS.includes(sortEntry.id) ? (sortEntry.id as UserListSortBy) : undefined;
  const listParams = {
    search: search === '' ? undefined : search,
    status: statusFilter === '' ? undefined : statusFilter,
    sortBy,
    sortDirection: sortEntry ? (sortEntry.desc ? ('desc' as const) : ('asc' as const)) : undefined,
  };

  const roleFilterActive = roleFilter !== '';
  const pageQuery = useQuery({
    ...adminUsersListQueryOptions({ ...listParams, page: pagination.pageIndex + 1, pageSize: pagination.pageSize }),
    placeholderData: keepPreviousData,
    enabled: !roleFilterActive,
  });
  const holdersQuery = useQuery({
    ...roleHoldersQueryOptions(roleFilter, systemContextId ?? ''),
    enabled: roleFilterActive && systemContextId !== undefined,
  });
  const allUsersQuery = useQuery({
    ...adminUsersAllQueryOptions(listParams),
    placeholderData: keepPreviousData,
    enabled: roleFilterActive,
  });

  const holders = holdersQuery.data;
  const roleFilteredUsers =
    roleFilterActive && holders
      ? (allUsersQuery.data?.users ?? []).filter((u) => holders.has(u.id))
      : [];
  const total = roleFilterActive ? roleFilteredUsers.length : (pageQuery.data?.total ?? 0);
  const rows: UserProfile[] = roleFilterActive
    ? roleFilteredUsers.slice(
        pagination.pageIndex * pagination.pageSize,
        pagination.pageIndex * pagination.pageSize + pagination.pageSize,
      )
    : (pageQuery.data?.users ?? []);
  const pageCount = Math.ceil(total / pagination.pageSize);
  const listPending = roleFilterActive
    ? allUsersQuery.isPending || holdersQuery.isPending || (roleFilterActive && systemContextId === undefined && !contextsQuery.isError)
    : pageQuery.isPending;
  const listFetching = roleFilterActive
    ? allUsersQuery.isFetching || holdersQuery.isFetching
    : pageQuery.isFetching;
  const listError = roleFilterActive
    ? allUsersQuery.isError || holdersQuery.isError || contextsQuery.isError
    : pageQuery.isError;

  if (!listPending && pagination.pageIndex > Math.max(0, pageCount - 1)) {
    setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageCount - 1) }));
  }

  const assignmentQueries = useQueries({
    queries: rows.map((u) => userAssignmentsQueryOptions(u.id)),
  });
  const assignmentsByUserId = new Map(rows.map((u, i) => [u.id, assignmentQueries[i]] as const));

  function handleSortingChange(updater: SortingState | ((old: SortingState) => SortingState)) {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }

  function refetchList() {
    if (roleFilterActive) {
      void allUsersQuery.refetch();
      void holdersQuery.refetch();
      void contextsQuery.refetch();
    } else {
      void pageQuery.refetch();
    }
  }

  async function suspend(id: string, suspended: boolean) {
    await suspendMutation.mutateAsync({ id, suspended });
  }

  function initialsOf(user: UserProfile): string {
    const parts = [user.firstName, user.lastName].map((s) => s.trim()).filter((s) => s !== '');
    if (parts.length === 0) return user.username.charAt(0).toUpperCase();
    return parts.map((s) => s.charAt(0).toUpperCase()).join('');
  }

  function fullNameOf(user: UserProfile): string {
    const fullName = `${user.firstName} ${user.lastName}`.trim();
    return fullName === '' ? user.username : fullName;
  }

  function statusBadgeOf(user: UserProfile) {
    if (user.deleted) return <Badge variant="destructive">{t('userStatusDeleted')}</Badge>;
    if (user.suspended) return <Badge variant="secondary">{t('userStatusSuspended')}</Badge>;
    return <Badge>{t('statusActive')}</Badge>;
  }

  function roleCellOf(user: UserProfile) {
    const result = assignmentsByUserId.get(user.id);
    if (!result || result.isPending) {
      return <span className="text-sm text-muted-foreground">{t('loading')}</span>;
    }
    if (result.isError || !result.data) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    const items = result.data.assignments;
    const systemItems = systemContextId ? items.filter((a) => a.contextId === systemContextId) : [];
    const systemRoleIds = [...new Set(systemItems.map((a) => a.roleId))];
    const otherCount = Math.max(0, result.data.total - systemItems.length);
    return (
      <span className="block space-y-0.5">
        {systemRoleIds.length > 0 ? (
          systemRoleIds.map((roleId) => (
            <span key={roleId} className="block">
              {roles.find((r) => r.id === roleId)?.name ?? roleId}
            </span>
          ))
        ) : (
          <span className="block text-muted-foreground">{t('userNoSystemRoles')}</span>
        )}
        {otherCount > 0 ? (
          <span className="block text-sm text-muted-foreground">
            {t('userOtherContextRoles', { count: otherCount })}
          </span>
        ) : null}
        <Link to={`/admin/roles?userId=${user.id}`} className="block text-sm underline">
          {t('userViewRoles')}
        </Link>
      </span>
    );
  }

  const columns: DataColumn<UserProfile>[] = [
    {
      id: 'name',
      header: t('userColumnUser'),
      sortValue: (u) => fullNameOf(u),
      cell: (u) => (
        <span className="flex items-center gap-2">
          <Avatar>
            <AvatarFallback>{initialsOf(u)}</AvatarFallback>
          </Avatar>
          <span>
            <strong className="block">{fullNameOf(u)}</strong>
            {u.email ? <span className="block text-sm text-muted-foreground">{u.email}</span> : null}
          </span>
        </span>
      ),
    },
    {
      id: 'role',
      header: t('userColumnRole'),
      cell: (u) => roleCellOf(u),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (u) => statusBadgeOf(u),
    },
    {
      id: 'createdAt',
      header: t('userColumnJoined'),
      sortValue: (u) => u.createdAt,
      cell: (u) => formatDate(u.createdAt),
    },
    {
      id: 'lastLogin',
      header: t('userColumnLastLogin'),
      sortValue: (u) => u.lastLogin ?? '',
      cell: (u) =>
        u.lastLogin ? (
          formatDate(u.lastLogin)
        ) : (
          <span className="text-muted-foreground">{t('userNeverLoggedIn')}</span>
        ),
    },
    {
      id: 'actions',
      header: t('actions'),
      cell: (u) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" render={<Link to={`/admin/users/${u.id}/edit`} />}>
            {t('editAction')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void suspend(u.id, !u.suspended)}>
            {u.suspended ? t('unsuspend') : t('suspend')}
          </Button>
          {!u.deleted ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setMessage(null);
                setDeleteTarget(u);
              }}
            >
              {t('deleteAction')}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon" aria-label={t('userMoreActions')} />}
            >
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/admin/users/${u.id}/edit`)}>
                {t('editAction')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void suspend(u.id, !u.suspended)}>
                {u.suspended ? t('unsuspend') : t('suspend')}
              </DropdownMenuItem>
              {!u.deleted ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    setMessage(null);
                    setDeleteTarget(u);
                  }}
                >
                  {t('deleteAction')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <PageShell width="full">
      <SectionCards
        cards={[
          {
            id: 'total',
            label: t('usersStatTotal'),
            value: String(totalUsersCount),
            loading: statsPending,
          },
          {
            id: 'active',
            label: t('statusActive'),
            value: String(activeStatQuery.data?.total ?? 0),
            loading: activeStatQuery.isPending,
          },
          {
            id: 'suspended',
            label: t('userStatusSuspended'),
            value: String(suspendedStatQuery.data?.total ?? 0),
            loading: suspendedStatQuery.isPending,
          },
          {
            id: 'deleted',
            label: t('userStatusDeleted'),
            value: String(deletedStatQuery.data?.total ?? 0),
            loading: deletedStatQuery.isPending,
          },
        ]}
      />
      {message ? <ErrorAlert>{message}</ErrorAlert> : null}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-72 max-w-full">
              <FieldLabel htmlFor="users-search">{t('searchUsers')}</FieldLabel>
              <Input
                id="users-search"
                placeholder={t('searchUsersPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="users-status-filter">{t('userFilterStatus')}</FieldLabel>
              <NativeSelect
                id="users-status-filter"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilterValue);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
              >
                <NativeSelectOption value="">{t('userFilterStatusDefault')}</NativeSelectOption>
                <NativeSelectOption value="active">{t('statusActive')}</NativeSelectOption>
                <NativeSelectOption value="suspended">{t('userStatusSuspended')}</NativeSelectOption>
                <NativeSelectOption value="deleted">{t('userStatusDeleted')}</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="users-role-filter">{t('userFilterRole')}</FieldLabel>
              <NativeSelect
                id="users-role-filter"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
              >
                <NativeSelectOption value="">{t('userFilterRoleAll')}</NativeSelectOption>
                {roles.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {r.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Field className="w-auto">
              <FieldLabel htmlFor="users-pagesize">{t('userPageSize')}</FieldLabel>
              <NativeSelect
                id="users-pagesize"
                value={String(pagination.pageSize)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPagination({
                    pageIndex: 0,
                    pageSize: USER_PAGE_SIZE_OPTIONS.includes(next as 10 | 25 | 50 | 100) ? next : 10,
                  });
                }}
              >
                {USER_PAGE_SIZE_OPTIONS.map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    {String(n)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button type="button" render={<Link to="/admin/users/new" />}>
              <Plus aria-hidden />
              {t('createUser')}
            </Button>
          </div>
          {listError ? (
            <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
              <span>{t('usersLoadFailed')}</span>
              <Button type="button" variant="outline" size="sm" onClick={refetchList}>
                {t('retry')}
              </Button>
            </ErrorAlert>
          ) : null}
          {listFetching && !listPending ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : null}
          {listPending ? (
            <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-9 w-full']} />
          ) : null}
        </CardContent>
        {listPending ? null : (
          <DataTable
            data={rows}
            columns={columns}
            labels={{
              columns: t('dashboard:tableColumns'),
              previous: t('dashboard:tablePrevious'),
              next: t('dashboard:tableNext'),
              empty: t('usersEmpty'),
              pageInfo: (page, pages) => t('dashboard:tablePageInfo', { page, pages }),
              rangeInfo: (from, to, rangeTotal) => t('usersShowing', { from, to, total: rangeTotal }),
            }}
            totalRows={total}
            getRowId={(u) => u.id}
            manualPagination
            manualSorting
            sorting={sorting}
            onSortingChange={handleSortingChange}
            pageCount={pageCount}
            pagination={pagination}
            onPaginationChange={setPagination}
          />
        )}
      </Card>
      {deleteTarget !== null ? (
        <UserDeleteDialog
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setMessage(t('userDeleted'))}
        />
      ) : null}
    </PageShell>
  );
}


export function AdminUserNewPage() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const createMutation = useCreateAdminUser();
  const [draft, setDraft] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createMutation.mutateAsync(draft);
      navigate('/admin/users');
    } catch {
      setError(t('userCreateFailed'));
    }
  }

  return (
    <UserFormScreen title={t('createUser')}>
      <form onSubmit={(e) => void createUser(e)}>
        <FieldGroup>
          {error ? (
            <ErrorAlert variant="destructive">
              {error}
            </ErrorAlert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="new-username">{t('username')}</FieldLabel>
            <Input
              id="new-username"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-email">{t('email')}</FieldLabel>
            <Input
              id="new-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">{t('password')}</FieldLabel>
            <Input
              id="new-password"
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit">{t('create')}</Button>
          </div>
        </FieldGroup>
      </form>
    </UserFormScreen>
  );
}

export function AdminUserEditPage() {
  const { t } = useTranslation('app');
  const { userId } = useParams();
  const navigate = useNavigate();
  const userQuery = useAdminUserDetail(userId);
  const updateMutation = useUpdateAdminUser();
  const [draft, setDraft] = useState<{ email: string; firstName: string; lastName: string; password: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const form = draft ?? {
    email: userQuery.data?.email ?? '',
    firstName: userQuery.data?.firstName ?? '',
    lastName: userQuery.data?.lastName ?? '',
    password: '',
  };

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setError(null);
    try {
      await updateMutation.mutateAsync({
        userId,
        draft: {
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          ...(form.password ? { password: form.password } : {}),
        },
      });
      navigate('/admin/users');
    } catch {
      setError(t('userUpdateFailed'));
    }
  }

  if (userQuery.isPending) {
    return (
      <PageShell width="narrow">
        <PageHeader title={t('editUserTitle', { username: '' })} />
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-9 w-full']} />
      </PageShell>
    );
  }
  if (userQuery.isError || !userQuery.data) {
    return (
      <PageShell width="narrow">
        <PageHeader title={t('editUserTitle', { username: '' })} />
        <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
          <span>{t('userLoadFailed')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void userQuery.refetch()}>
            {t('retry')}
          </Button>
        </ErrorAlert>
        <p>
          <Link to="/admin/users" className="text-sm underline">
            {t('backToUsersList')}
          </Link>
        </p>
      </PageShell>
    );
  }

  return (
    <UserFormScreen title={t('editUserTitle', { username: userQuery.data.username })}>
      <form onSubmit={(e) => void saveUser(e)}>
        <FieldGroup>
          {error ? (
            <ErrorAlert variant="destructive">
              {error}
            </ErrorAlert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="edit-email">{t('email')}</FieldLabel>
            <Input
              id="edit-email"
              type="email"
              value={form.email}
              onChange={(e) => setDraft({ ...form, email: e.target.value })}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-firstname">{t('firstName')}</FieldLabel>
            <Input
              id="edit-firstname"
              value={form.firstName}
              onChange={(e) => setDraft({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-lastname">{t('lastName')}</FieldLabel>
            <Input
              id="edit-lastname"
              value={form.lastName}
              onChange={(e) => setDraft({ ...form, lastName: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-password">{t('newPasswordOptional')}</FieldLabel>
            <Input
              id="edit-password"
              type="password"
              value={form.password}
              onChange={(e) => setDraft({ ...form, password: e.target.value })}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit">{t('curriculumSave')}</Button>
          </div>
        </FieldGroup>
      </form>
    </UserFormScreen>
  );
}
