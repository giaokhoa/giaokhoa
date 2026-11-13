import { useState } from 'react';
import type { RoleListItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent } from '@giaokhoa/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { EllipsisVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import { PageShell } from '#components/page-shell';
import '#config/i18n';
import { useAccessCapabilities, useAccessContexts, useAccessRoles, useRoleCapabilities } from '#lib/access';
import { RoleAssignmentsSection } from '../components/role-assignments';
import { RoleDeleteDialog } from '../components/role-delete-dialog';
import { RoleMatrixDialog } from '../components/role-matrix-dialog';
import { UsersWithRolesSection } from '../components/users-with-roles';

export function AdminRolesPage() {
  const { t } = useTranslation('app');
  const [matrixDialog, setMatrixDialog] = useState<{
    mode: 'create' | 'edit';
    role: RoleListItem | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleListItem | null>(null);

  const rolesQuery = useAccessRoles();
  const capabilitiesQuery = useAccessCapabilities();
  const contextsQuery = useAccessContexts();
  const matrixRole = matrixDialog?.mode === 'edit' ? matrixDialog.role : null;
  const matrixQuery = useRoleCapabilities(matrixRole?.id ?? null);

  const roles = rolesQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const contexts = contextsQuery.data ?? [];
  const matrix = matrixQuery.data ?? [];
  const loading = rolesQuery.isPending || capabilitiesQuery.isPending || contextsQuery.isPending;
  const rolesLoadFailed = rolesQuery.isError && rolesQuery.data === undefined;
  const supportLoadFailed =
    !rolesLoadFailed &&
    ((capabilitiesQuery.isError && capabilitiesQuery.data === undefined) ||
      (contextsQuery.isError && contextsQuery.data === undefined));

  return (
    <PageShell width="app" contentClassName="gap-6">
      {rolesLoadFailed ? (
        <>
          <ErrorAlert variant="destructive">{t('rolesLoadFailed')}</ErrorAlert>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void rolesQuery.refetch();
                void capabilitiesQuery.refetch();
                void contextsQuery.refetch();
              }}
            >
              {t('retry')}
            </Button>
          </div>
        </>
      ) : null}
      {supportLoadFailed ? (
        <ErrorAlert
          variant="destructive"
          descriptionClassName="flex items-center justify-between gap-2"
        >
          <span>{t('rolesSupportLoadFailed')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void capabilitiesQuery.refetch();
              void contextsQuery.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </ErrorAlert>
      ) : null}
      {loading ? (
        <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full', 'h-9 w-full']} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex justify-between gap-2">
                    <div>
                      <h4 className="text-base leading-tight font-medium">{r.name}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('roleUsersCount', { count: r.userCount ?? 0 })}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('roleActions')} />
                        }
                      >
                        <EllipsisVertical aria-hidden className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setMatrixDialog({ mode: 'edit', role: r })}>
                          <Pencil aria-hidden className="size-4" />
                          {t('editRole')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(r)}>
                          <Trash2 aria-hidden className="size-4" />
                          {t('deleteRole')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                    <div className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-sm font-semibold">{r.readOverrideCount ?? 0}</span>
                      <span className="text-[10px] text-muted-foreground">{t('roleReadLabel')}</span>
                    </div>
                    <div className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-sm font-semibold">{r.writeOverrideCount ?? 0}</span>
                      <span className="text-[10px] text-muted-foreground">{t('roleWriteLabel')}</span>
                    </div>
                    <div className="h-6 w-px bg-border" aria-hidden />
                    <div className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-sm font-semibold">{r.resourceCount ?? 0}</span>
                      <span className="text-[10px] text-muted-foreground">{t('roleTotalLabel')}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card className="items-center justify-center">
              <CardContent className="flex flex-col items-center justify-center gap-4">
                <div className="text-center">
                  <p className="text-lg font-medium">{t('addRoleCard')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('addRoleCardDescription')}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setMatrixDialog({ mode: 'create', role: null })}
                >
                  <Plus aria-hidden className="size-4" />
                  {t('addRoleCard')}
                </Button>
              </CardContent>
            </Card>
          </div>
          {roles.length === 0 ? (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyTitle>{t('noRolesYet')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
        </>
      )}

      <RoleAssignmentsSection roles={roles} contexts={contexts} />

      <UsersWithRolesSection roles={roles} contexts={contexts} />

      {matrixDialog !== null ? (
        <RoleMatrixDialog
          open
          mode={matrixDialog.mode}
          role={matrixDialog.role}
          capabilities={capabilities}
          matrixRows={matrix}
          matrixPending={matrixRole !== null && matrixQuery.isPending}
          matrixError={matrixRole !== null && matrixQuery.isError}
          onMatrixRetry={() => void matrixQuery.refetch()}
          contexts={contexts}
          onClose={() => setMatrixDialog(null)}
        />
      ) : null}
      {deleteTarget !== null ? (
        <RoleDeleteDialog open role={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
    </PageShell>
  );
}

export default AdminRolesPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navRoles');
}
