import { useState } from 'react';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button, buttonVariants } from '@giaokhoa/ui/components/button';
import { Empty, EmptyHeader, EmptyTitle } from '@giaokhoa/ui/components/empty';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CollapsibleSection } from '#components/collapsible-section';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { archiveClass, deleteClass, fetchClasses } from '../api/classes';
import type { ClassListItem } from '../types/classes';
import { queryKeys } from '#lib/query-keys';

export function ClassesPage() {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const classesQuery = useQuery({ queryKey: queryKeys.classes, queryFn: fetchClasses });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.classes });
  const archiveMutation = useMutation({
    mutationFn: (classId: string) => archiveClass(classId),
    onSuccess: () => {
      setMessage(t('classArchived'));
      invalidate();
    },
    onError: () => setMessage(t('classArchiveFailed')),
  });
  const deleteMutation = useMutation({
    mutationFn: (classId: string) => deleteClass(classId),
    onSuccess: () => {
      setMessage(t('classDeleted'));
      invalidate();
    },
    onError: () => setMessage(t('classDeleteFailed')),
  });

  function onArchive(cls: ClassListItem) {
    if (!window.confirm(t('classArchiveConfirm', { name: cls.name }))) return;
    setMessage(null);
    archiveMutation.mutate(cls.id);
  }

  function onDelete(cls: ClassListItem) {
    if (!window.confirm(t('classDeleteConfirm', { name: cls.name }))) return;
    setMessage(null);
    deleteMutation.mutate(cls.id);
  }

  const canCreateClass = (classesQuery.data ?? []).some((cls) => cls.canCreate);

  return (
    <PageShell>
      <PageHeader
        title={t('classesHeading')}
        description={t('classesDescription')}
        actions={
          canCreateClass ? (
            <Link className={buttonVariants()} to="/classes/new">
              {t('classesCreate')}
            </Link>
          ) : undefined
        }
      />
      {message ? (
        <ErrorAlert>
          {message}
        </ErrorAlert>
      ) : null}
      {classesQuery.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : classesQuery.isError ? (
        <ErrorAlert variant="destructive">
          {t('classesLoadFailed')}
        </ErrorAlert>
      ) : classesQuery.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('classesEmpty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {classesQuery.data.map((cls) => (
            <CollapsibleSection
              key={cls.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {cls.name}
                  {cls.code ? <Badge variant="secondary">{cls.code}</Badge> : null}
                  {cls.schoolYear ? <Badge variant="outline">{cls.schoolYear}</Badge> : null}
                  <Badge variant={cls.status === 'archived' ? 'destructive' : 'default'}>
                    {cls.status === 'archived' ? t('classStatusArchived') : t('classStatusActive')}
                  </Badge>
                </span>
              }
              open={openIds.includes(cls.id)}
              onOpenChange={(open) => setOpenIds((prev) => (open ? [...prev, cls.id] : prev.filter((x) => x !== cls.id)))}
            >
              {cls.description ? <p className="text-sm text-muted-foreground">{cls.description}</p> : null}
              <p className="text-sm text-muted-foreground">
                {t('classJoinCode')}: {cls.allowSelfReport && cls.joinCode ? cls.joinCode : '—'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link className={buttonVariants({ size: 'sm' })} to={`/classes/${cls.id}`}>
                  {t('classRoster')}
                </Link>
                {cls.canUpdate ? (
                  <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} to={`/classes/${cls.id}/edit`}>
                    {t('classEdit')}
                  </Link>
                ) : null}
                {cls.canUpdate && cls.status === 'active' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onArchive(cls)}>
                    {t('classArchive')}
                  </Button>
                ) : null}
                {cls.canDelete ? (
                  <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(cls)}>
                    {t('classDelete')}
                  </Button>
                ) : null}
              </div>
            </CollapsibleSection>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default ClassesPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('classesHeading');
}
