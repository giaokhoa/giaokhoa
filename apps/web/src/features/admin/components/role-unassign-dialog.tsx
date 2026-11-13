import { useState } from 'react';
import type { AssignmentListItem } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@giaokhoa/ui/components/dialog';
import { ErrorAlert } from '#components/error-alert';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { ApiError } from '#lib/api';
import { useDeleteRoleAssignment } from '../queries/admin-roles';

export interface UnassignTarget {
  assignment: Pick<AssignmentListItem, 'id'>;
  userLabel: string;
  roleLabel: string;
  contextLabel: string;
}

export interface RoleUnassignDialogProps {
  open: boolean;
  target: UnassignTarget | null;
  onClose: () => void;
}

function unassignErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && error.problem.code === 'access.assignment_enrol_managed') {
    return t('assignmentEnrolManaged');
  }
  return t('unassignRoleFailed');
}

export function RoleUnassignDialog({ open, target, onClose }: RoleUnassignDialogProps) {
  const { t } = useTranslation('app');
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useDeleteRoleAssignment();

  if (!open || !target) return null;

  async function confirmUnassign() {
    if (!target) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(target.assignment.id);
      onClose();
    } catch (caught) {
      setError(unassignErrorMessage(caught, (key) => t(key)));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !deleteMutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-semibold">{t('unassignRoleTitle')}</DialogTitle>
          <DialogDescription>
            {t('unassignRoleConfirm', {
              role: target.roleLabel,
              user: target.userLabel,
              context: target.contextLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        {error ? <ErrorAlert variant="destructive">{error}</ErrorAlert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleteMutation.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => void confirmUnassign()}
          >
            {deleteMutation.isPending ? t('unassigningRole') : t('unassignRole')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
