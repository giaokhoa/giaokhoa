import { useState } from 'react';
import type { RoleListItem } from '@giaokhoa/contracts';
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
import { ApiError } from '#lib/api';
import { useTranslation } from 'react-i18next';
import '#config/i18n';
import { useDeleteRole } from '../queries/admin-roles';

export interface RoleDeleteDialogProps {
  open: boolean;
  role: RoleListItem | null;
  onClose: () => void;
}

function deleteErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.problem.code === 'access.role_archetype_delete_forbidden') {
      return t('deleteRoleArchetypeForbidden');
    }
    if (error.problem.code === 'access.role_has_assignments') {
      return t('deleteRoleHasAssignments');
    }
  }
  return t('deleteRoleFailed');
}

export function RoleDeleteDialog({ open, role, onClose }: RoleDeleteDialogProps) {
  const { t } = useTranslation('app');
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useDeleteRole();

  if (!open || !role) return null;

  async function confirmDelete() {
    if (!role) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(role.id);
      onClose();
    } catch (caught) {
      setError(deleteErrorMessage(caught, (key) => t(key)));
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
          <DialogTitle className="font-semibold">{t('deleteRole')}</DialogTitle>
          <DialogDescription>{t('deleteRoleConfirm', { name: role.name })}</DialogDescription>
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
            onClick={() => void confirmDelete()}
          >
            {deleteMutation.isPending ? t('deletingRole') : t('deleteRole')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
