import { useState } from 'react';
import type { UserProfile } from '@giaokhoa/contracts';
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
import { useDeleteAdminUser } from '../queries/admin-users';

export interface UserDeleteDialogProps {
  user: UserProfile;
  onClose: () => void;
  onDeleted: () => void;
}

function displayNameOf(user: UserProfile): string {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return fullName === '' ? user.username : fullName;
}

export function UserDeleteDialog({ user, onClose, onDeleted }: UserDeleteDialogProps) {
  const { t } = useTranslation('app');
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useDeleteAdminUser();

  async function confirmDelete() {
    setError(null);
    try {
      await deleteMutation.mutateAsync(user.id);
      onDeleted();
      onClose();
    } catch {
      setError(t('userDeleteFailed'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !deleteMutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteUserTitle')}</DialogTitle>
          <DialogDescription>
            {t('confirmDeleteUser', { username: displayNameOf(user) })}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorAlert variant="destructive">
            {error}
          </ErrorAlert>
        ) : null}
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
            {deleteMutation.isPending ? t('deletingUser') : t('deleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
