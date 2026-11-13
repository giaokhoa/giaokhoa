import { useState } from 'react';
import type { UserWithAssignmentsListItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@giaokhoa/ui/components/dialog';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import type { ContextRow } from '#lib/access';
import { assignmentContextLabel } from '../api/context-labels';
import { RoleUnassignDialog, type UnassignTarget } from './role-unassign-dialog';

export interface RoleUserDialogProps {
  open: boolean;
  user: UserWithAssignmentsListItem;
  contexts: ContextRow[];
  onClose: () => void;
  onAssignForUser: (user: UserWithAssignmentsListItem) => void;
}

export function userDisplayName(user: UserWithAssignmentsListItem): string {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return fullName === '' ? user.username : fullName;
}

export function RoleUserDialog({ open, user, contexts, onClose, onAssignForUser }: RoleUserDialogProps) {
  const { t } = useTranslation('app');
  const [unassignTarget, setUnassignTarget] = useState<UnassignTarget | null>(null);

  if (!open) return null;

  const displayName = userDisplayName(user);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && unassignTarget === null) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-semibold">{t('userRolesManageTitle', { name: displayName })}</DialogTitle>
          <DialogDescription>{t('userRolesManageDescription')}</DialogDescription>
        </DialogHeader>
        {user.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('userRolesManageEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {user.assignments.map((assignment) => {
              const contextLabel = assignmentContextLabel(contexts, assignment, (key, options) =>
                t(key, options),
              );
              return (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                >
                  <span>
                    <span className="block font-medium">{assignment.roleName}</span>
                    <span className="block text-sm text-muted-foreground">{contextLabel}</span>
                  </span>
                  {assignment.component === 'enrol' ? (
                    <span className="text-sm text-muted-foreground">{t('assignmentEnrolManaged')}</span>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setUnassignTarget({
                          assignment: { id: assignment.id },
                          userLabel: displayName,
                          roleLabel: assignment.roleName,
                          contextLabel,
                        })
                      }
                    >
                      {t('unassignRole')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => onAssignForUser(user)}>
            {t('userRolesAssignMore')}
          </Button>
        </DialogFooter>
        {unassignTarget !== null ? (
          <RoleUnassignDialog open target={unassignTarget} onClose={() => setUnassignTarget(null)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
