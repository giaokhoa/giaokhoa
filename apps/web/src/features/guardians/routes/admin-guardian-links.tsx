import { useMemo, useState, type FormEvent } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { UserProfile } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { Input } from '@giaokhoa/ui/components/input';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from '#components/error-alert';
import { PageSkeleton } from '#components/page-skeleton';
import { PageHeader, PageShell } from '#components/page-shell';
import '#config/i18n';
import { adminUserDetailQueryOptions, adminUsersQueryOptions } from '#features/admin/queries/admin-users';
import { ApiError } from '#lib/api';
import { personName } from '#features/classes/api/classes';
import { formatDate } from '#utils/date-format';
import { guardianLinksQueryOptions, useCreateGuardianLink, useRevokeGuardianLink } from '../queries/guardians';
import type { GuardianLinkView } from '../types/guardians';
import { usePermissions } from '#lib/permissions';


interface UserPickerProps {
  label: string;
  value: UserProfile | null;
  onChange: (user: UserProfile | null) => void;
}

function personLabel(user: UserProfile): string {
  return personName(user);
}

function UserPicker({ label, value, onChange }: UserPickerProps) {
  const { t } = useTranslation('app');
  const [search, setSearch] = useState('');
  const searchQuery = useQuery({
    ...adminUsersQueryOptions(1, 10, search.trim()),
    enabled: value === null && search.trim().length > 0,
  });
  const results = searchQuery.data?.users ?? [];

  if (value) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {t('guardianLinksSelectedUser', { name: personLabel(value), username: value.username })}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            {t('guardianLinksPickAnother')}
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        aria-label={label}
        placeholder={t('guardianLinksUserSearchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim().length > 0 ? (
        <div className="flex flex-col gap-1">
          {searchQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('guardianLinksUserSearchEmpty')}</p>
          ) : (
            results.map((user) => (
              <Button
                key={user.id}
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => {
                  onChange(user);
                  setSearch('');
                }}
              >
                {personLabel(user)} ({user.username})
                {user.email ? ` — ${user.email}` : ''}
              </Button>
            ))
          )}
        </div>
      ) : null}
    </Field>
  );
}

export function AdminGuardianLinksPage() {
  const { t } = useTranslation('app');
  const perms = usePermissions();
  const canManage = perms.canManageGuardians;

  const linksQuery = useQuery({ ...guardianLinksQueryOptions(), enabled: canManage });
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);

  const userIds = useMemo(
    () => [...new Set(links.flatMap((link) => [link.guardianUserId, link.studentUserId]))],
    [links],
  );
  const userQueries = useQueries({
    queries: userIds.map((id) => adminUserDetailQueryOptions(id)),
  });
  const usersById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    userQueries.forEach((query, index) => {
      if (query.data) map.set(userIds[index]!, query.data);
    });
    return map;
  }, [userQueries, userIds]);
  const userLabel = (userId: string): string => {
    const user = usersById.get(userId);
    return user ? `${personLabel(user)} (${user.username})` : userId;
  };

  const [guardian, setGuardian] = useState<UserProfile | null>(null);
  const [student, setStudent] = useState<UserProfile | null>(null);
  const [relationship, setRelationship] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGuardianLink();
  const revokeMutation = useRevokeGuardianLink();

  function apiErrorText(err: unknown, fallback: string): string {
    if (err instanceof ApiError) return err.problem.detail ?? err.problem.title ?? fallback;
    return fallback;
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!guardian || !student || relationship.trim() === '') {
      setError(t('guardianLinksFormIncomplete'));
      return;
    }
    try {
      await createMutation.mutateAsync({
        guardianUserId: guardian.id,
        studentUserId: student.id,
        relationship: relationship.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setGuardian(null);
      setStudent(null);
      setRelationship('');
      setNote('');
      setMessage(t('guardianLinksCreated'));
    } catch (err) {
      setError(apiErrorText(err, t('guardianLinksCreateFailed')));
    }
  }

  async function onRevoke(link: GuardianLinkView) {
    const confirmText = t('guardianLinksRevokeConfirm', {
      guardian: userLabel(link.guardianUserId),
      student: userLabel(link.studentUserId),
    });
    if (!window.confirm(confirmText)) return;
    setMessage(null);
    setError(null);
    try {
      await revokeMutation.mutateAsync(link.id);
      setMessage(t('guardianLinksRevoked'));
    } catch (err) {
      setError(apiErrorText(err, t('guardianLinksRevokeFailed')));
    }
  }

  if (!perms.capabilitiesError && (!perms.ready || !perms.access))
    return <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-48 w-full', 'h-48 w-full']} />;

  if (!canManage) {
    return (
      <PageShell width="narrow">
        <PageHeader title={t('guardianLinksTitle')} description={t('guardianLinksDescription')} />
        <ErrorAlert variant="destructive">{t('guardianLinksNoAccess')}</ErrorAlert>
      </PageShell>
    );
  }

  return (
    <PageShell width="full">
      <PageHeader title={t('guardianLinksTitle')} description={t('guardianLinksDescription')} />
      {message ? <ErrorAlert>{message}</ErrorAlert> : null}
      {error ? <ErrorAlert variant="destructive">{error}</ErrorAlert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('guardianLinksCreateTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void onCreate(event)}>
            <FieldGroup>
              <UserPicker label={t('guardianLinksGuardian')} value={guardian} onChange={setGuardian} />
              <UserPicker label={t('guardianLinksStudent')} value={student} onChange={setStudent} />
              <Field>
                <FieldLabel>{t('guardianLinksRelationship')}</FieldLabel>
                <Input
                  aria-label={t('guardianLinksRelationship')}
                  placeholder={t('guardianLinksRelationshipPlaceholder')}
                  value={relationship}
                  maxLength={100}
                  onChange={(e) => setRelationship(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('guardianLinksNote')}</FieldLabel>
                <Input
                  aria-label={t('guardianLinksNote')}
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <div>
                <Button type="submit" disabled={createMutation.isPending}>
                  {t('guardianLinksCreate')}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('guardianLinksListTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {linksQuery.isError ? (
            <ErrorAlert variant="destructive" descriptionClassName="flex items-center justify-between gap-2">
              <span>{t('guardianLinksLoadFailed')}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void linksQuery.refetch()}>
                {t('retry')}
              </Button>
            </ErrorAlert>
          ) : null}
          {linksQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('guardianLinksEmpty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pr-4 font-medium">{t('guardianLinksGuardian')}</th>
                  <th className="py-2 pr-4 font-medium">{t('guardianLinksStudent')}</th>
                  <th className="py-2 pr-4 font-medium">{t('guardianLinksRelationship')}</th>
                  <th className="py-2 pr-4 font-medium">{t('guardianLinksStatus')}</th>
                  <th className="py-2 pr-4 font-medium">{t('guardianLinksCreatedAt')}</th>
                  <th className="py-2 font-medium">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id} className="border-t">
                    <td className="py-2 pr-4">{userLabel(link.guardianUserId)}</td>
                    <td className="py-2 pr-4">{userLabel(link.studentUserId)}</td>
                    <td className="py-2 pr-4">{link.relationship}</td>
                    <td className="py-2 pr-4">
                      {link.status === 'active' ? t('guardianLinksStatusActive') : t('guardianLinksStatusRevoked')}
                    </td>
                    <td className="py-2 pr-4">{formatDate(link.createdAt)}</td>
                    <td className="py-2">
                      {link.status === 'active' ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => void onRevoke(link)}
                        >
                          {t('guardianLinksRevoke')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default AdminGuardianLinksPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('guardianLinksTitle');
}
