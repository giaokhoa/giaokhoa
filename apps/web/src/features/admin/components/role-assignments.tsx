import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AssignmentListItem, RoleListItem } from '@giaokhoa/contracts';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldLabel } from '@giaokhoa/ui/components/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@giaokhoa/ui/components/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@giaokhoa/ui/components/table';
import { Plus, Search, UserMinus } from 'lucide-react';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import type { ContextRow } from '#lib/access';
import { formatWithOptions } from '#utils/date-format';
import { contextOptionLabel } from '../api/context-labels';
import { roleAssignmentsQueryOptions } from '../queries/admin-roles';
import { AdminSelect } from './admin-select';
import { RoleAssignmentDialog } from './role-assignment-dialog';
import { RoleUnassignDialog, type UnassignTarget } from './role-unassign-dialog';
import { TablePagination } from './table-pagination';

export interface RoleAssignmentsSectionProps {
  roles: RoleListItem[];
  contexts: ContextRow[];
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function RoleAssignmentsSection({ roles, contexts }: RoleAssignmentsSectionProps) {
  const { t } = useTranslation('app');
  const [roleFilter, setRoleFilter] = useState('');
  const [contextFilter, setContextFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<UnassignTarget | null>(null);

  const assignmentsQuery = useQuery({
    ...roleAssignmentsQueryOptions({
      roleId: roleFilter === '' ? undefined : roleFilter,
      contextId: contextFilter === '' ? undefined : contextFilter,
      search: search === '' ? undefined : search,
      page,
      pageSize,
    }),
    placeholderData: keepPreviousData,
  });
  const data = assignmentsQuery.data;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (data && page > pageCount) {
    setPage(pageCount);
  }
  const rows = data?.assignments ?? [];
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = (page - 1) * pageSize + rows.length;

  function roleNameOf(row: AssignmentListItem): string {
    return roles.find((r) => r.id === row.roleId)?.name ?? '—';
  }

  function contextLabelOf(row: AssignmentListItem): string {
    const ctx = contexts.find((c) => c.id === row.contextId);
    if (!ctx) return '—';
    return contextOptionLabel(contexts, ctx, (key, options) => t(key, options));
  }

  function userLabelOf(row: AssignmentListItem): string {
    return row.userName ?? t('assignmentMissingUser');
  }

  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="border-b px-6 py-5">
        <CardTitle className="text-lg">{t('assignmentTableTitle')}</CardTitle>
        <CardDescription>{t('assignmentTableDescription')}</CardDescription>
      </CardHeader>
      <div className="border-b">
        <div className="flex flex-col gap-4 border-b p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="assignment-role-filter">{t('assignmentFilterRole')}</FieldLabel>
              <AdminSelect
                id="assignment-role-filter"
                value={roleFilter}
                onValueChange={(next) => {
                  setRoleFilter(next);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('assignmentFilterRoleAll') },
                  ...roles.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="assignment-context-filter">{t('assignmentFilterContext')}</FieldLabel>
              <AdminSelect
                id="assignment-context-filter"
                value={contextFilter}
                onValueChange={(next) => {
                  setContextFilter(next);
                  setPage(1);
                }}
                options={[
                  { value: '', label: t('assignmentFilterContextAll') },
                  ...contexts.map((c) => ({
                    value: c.id,
                    label: contextOptionLabel(contexts, c, (key, options) => t(key, options)),
                  })),
                ]}
              />
            </Field>
          </div>
        </div>
        <div className="flex gap-4 p-6 max-sm:flex-col sm:items-center sm:justify-between">
          <Field className="w-full max-w-2xs">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                id="assignment-search"
                aria-label={t('assignmentSearch')}
                placeholder={t('assignmentSearchPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </InputGroup>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <AdminSelect
              id="assignment-pagesize"
              ariaLabel={t('assignmentPageSize')}
              className="w-fit"
              value={String(pageSize)}
              onValueChange={(next) => {
                const size = Number(next);
                setPageSize(PAGE_SIZE_OPTIONS.includes(size as 10 | 20 | 50) ? size : 20);
                setPage(1);
              }}
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <Button type="button" className="h-9 gap-1.5 px-2.5" onClick={() => setAssignOpen(true)}>
              <Plus aria-hidden className="size-4" />
              {t('assignRole')}
            </Button>
          </div>
        </div>
      </div>
      {assignmentsQuery.isError ? (
        <div className="px-6 pt-4">
          <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
            <span>{t('assignmentLoadFailed')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void assignmentsQuery.refetch()}>
              {t('retry')}
            </Button>
          </ErrorAlert>
        </div>
      ) : null}
      {assignmentsQuery.isFetching && !assignmentsQuery.isPending ? (
        <p className="px-6 pt-4 text-sm text-muted-foreground">{t('loading')}</p>
      ) : null}
      {assignmentsQuery.isPending ? (
        <div className="p-6">
          <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-9 w-full']} />
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="h-14 border-t hover:bg-transparent">
                <TableHead className="pl-4 text-muted-foreground">{t('assignmentUserColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('assignmentRoleColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('assignmentContextColumn')}</TableHead>
                <TableHead className="text-muted-foreground">{t('assignmentAssignedAtColumn')}</TableHead>
                <TableHead className="pr-4 text-center text-muted-foreground">
                  {t('assignmentActionsColumn')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    {t('assignmentEmpty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="h-14">
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2">
                        <Avatar className="size-9">
                          <AvatarFallback className="text-xs">
                            {row.userName ? row.userName.charAt(0) : '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          <span className="block text-sm font-medium">{userLabelOf(row)}</span>
                          <span className="block text-sm text-muted-foreground">{row.userEmail ?? '—'}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>{roleNameOf(row)}</TableCell>
                    <TableCell>{contextLabelOf(row)}</TableCell>
                    <TableCell>
                      {formatWithOptions(row.updatedAt, undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="pr-4 text-center">
                      {row.component === 'enrol' ? (
                        <span className="text-sm text-muted-foreground">{t('assignmentEnrolManaged')}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={t('unassignRole')}
                          onClick={() =>
                            setUnassignTarget({
                              assignment: row,
                              userLabel: userLabelOf(row),
                              roleLabel: roleNameOf(row),
                              contextLabel: contextLabelOf(row),
                            })
                          }
                        >
                          <UserMinus aria-hidden className="size-4.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageCount={pageCount}
            summary={t('assignmentShowing', { from: rangeFrom, to: rangeTo, total })}
            previousLabel={t('dashboard:tablePrevious')}
            nextLabel={t('dashboard:tableNext')}
            onPageChange={setPage}
          />
        </>
      )}
      {assignOpen ? (
        <RoleAssignmentDialog open roles={roles} contexts={contexts} onClose={() => setAssignOpen(false)} />
      ) : null}
      {unassignTarget !== null ? (
        <RoleUnassignDialog open target={unassignTarget} onClose={() => setUnassignTarget(null)} />
      ) : null}
    </Card>
  );
}
