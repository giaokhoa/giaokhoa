import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { RoleListItem, UserProfile } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@giaokhoa/ui/components/dialog';
import { Field, FieldGroup, FieldLabel } from '@giaokhoa/ui/components/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@giaokhoa/ui/components/input-group';
import { Search } from 'lucide-react';
import { PageSkeleton } from '#components/page-skeleton';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { ApiError } from '#lib/api';
import type { ContextRow } from '#lib/access';
import { contextOptionLabel } from '../api/context-labels';
import { adminUsersQueryOptions } from '../queries/admin-users';
import { useCreateRoleAssignment } from '../queries/admin-roles';
import { AdminSelect } from './admin-select';

export interface RoleAssignmentDialogProps {
  open: boolean;
  roles: RoleListItem[];
  contexts: ContextRow[];
  presetUser?: Pick<UserProfile, 'id' | 'username' | 'email'> | null;
  onClose: () => void;
}

function assignErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.problem.code === 'plan.tenant_slot_limit_reached') {
      return t('assignSlotLimitReached');
    }
    if (error.problem.code === 'access.role_context_conflict') {
      return t('assignRoleContextConflict');
    }
  }
  return t('assignRoleFailed');
}

const MAX_USER_PAGE_SIZE = 100;

export function RoleAssignmentDialog({
  open,
  roles,
  contexts,
  presetUser = null,
  onClose,
}: RoleAssignmentDialogProps) {
  const { t } = useTranslation('app');
  const [userSearch, setUserSearch] = useState('');
  const [userPageSize, setUserPageSize] = useState(20);
  const [selectedUser, setSelectedUser] = useState<Pick<UserProfile, 'id' | 'username' | 'email'> | null>(null);
  const [roleId, setRoleId] = useState('');
  const [contextId, setContextId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateRoleAssignment();

  const usersQuery = useQuery({
    ...adminUsersQueryOptions(1, userPageSize, userSearch),
    placeholderData: keepPreviousData,
    enabled: open && presetUser === null,
  });

  if (!open) return null;

  const effectiveUser = presetUser ?? selectedUser;

  const effectiveContextId =
    contextId === '' ? (contexts.find((ctx) => ctx.contextLevel === 10)?.id ?? '') : contextId;

  async function submitAssign() {
    if (!effectiveUser || !roleId || !effectiveContextId) return;
    setError(null);
    try {
      await createMutation.mutateAsync({ userId: effectiveUser.id, roleId, contextId: effectiveContextId });
      onClose();
    } catch (caught) {
      setError(assignErrorMessage(caught, (key) => t(key)));
    }
  }

  const users = usersQuery.data?.users ?? [];
  const canSubmit = effectiveUser !== null && roleId !== '' && effectiveContextId !== '' && !createMutation.isPending;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !createMutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-semibold">{t('assignRoleDialogTitle')}</DialogTitle>
        </DialogHeader>
        {error ? <ErrorAlert variant="destructive">{error}</ErrorAlert> : null}
        <FieldGroup>
          {presetUser !== null ? (
            <Field>
              <FieldLabel>{t('assignPresetUserLabel')}</FieldLabel>
              <p className="text-sm">
                <strong>{presetUser.username}</strong>{' '}
                <span className="text-muted-foreground">{presetUser.email}</span>
              </p>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="assign-dialog-user-search">{t('assignUserSearch')}</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="assign-dialog-user-search"
                    placeholder={t('assignUserSearchPlaceholder')}
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setSelectedUser(null);
                      setUserPageSize(20);
                    }}
                  />
                </InputGroup>
              </Field>
              {usersQuery.isPending ? (
                <PageSkeleton label={t('loading')} rows={['h-9 w-full', 'h-9 w-full']} />
              ) : usersQuery.isError ? (
                <ErrorAlert variant="destructive">
                  {t('assignUsersLoadFailed')}{' '}
                  <Button type="button" variant="outline" size="sm" onClick={() => void usersQuery.refetch()}>
                    {t('retry')}
                  </Button>
                </ErrorAlert>
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('assignNoUserFound')}</p>
              ) : (
                <>
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {users.map((u) => {
                      const selected = selectedUser?.id === u.id;
                      return (
                        <li key={u.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            className={`w-full rounded-md border p-2 text-left hover:bg-accent ${selected ? 'border-primary bg-accent' : ''}`}
                            onClick={() => setSelectedUser({ id: u.id, username: u.username, email: u.email })}
                          >
                            <strong>{u.username}</strong>
                            <span className="block text-sm text-muted-foreground">{u.email ?? '—'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {users.length > 0 && users.length < (usersQuery.data?.total ?? 0) ? (
                    userPageSize < MAX_USER_PAGE_SIZE ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={usersQuery.isFetching}
                        onClick={() => setUserPageSize((s) => Math.min(s + 20, MAX_USER_PAGE_SIZE))}
                      >
                        {t('assignLoadMoreUsers')}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('assignLoadMoreAtCap')}</p>
                    )
                  ) : null}
                </>
              )}
            </>
          )}
          <Field>
            <FieldLabel htmlFor="assign-dialog-role">{t('role')}</FieldLabel>
            <AdminSelect
              id="assign-dialog-role"
              value={roleId}
              onValueChange={setRoleId}
              options={[
                { value: '', label: t('selectRole') },
                ...roles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="assign-dialog-context">{t('roleContext')}</FieldLabel>
            <AdminSelect
              id="assign-dialog-context"
              value={effectiveContextId}
              onValueChange={setContextId}
              options={[
                { value: '', label: t('selectContext') },
                ...contexts.map((c) => ({
                  value: c.id,
                  label: contextOptionLabel(contexts, c, (key, options) => t(key, options)),
                })),
              ]}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={createMutation.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submitAssign()}>
            {createMutation.isPending ? t('assigningRole') : t('assignRole')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
