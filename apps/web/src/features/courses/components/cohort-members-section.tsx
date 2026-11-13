import { useEffect } from 'react';
import type { Cohort } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { useTranslation } from 'react-i18next';
import { useAddCohortMember, useCohortMembers, useRemoveCohortMember } from '../queries/course-admin';

/** Mảng thành viên của một cohort đang mở: tải khi mở lần đầu, thêm/gỡ qua đột biến rồi danh sách tự làm mới. */
export function CohortMembersSection({
  cohort,
  canManageCohorts,
  input,
  onInputChange,
  onMessage,
}: {
  cohort: Cohort;
  canManageCohorts: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onMessage: (text: string) => void;
}) {
  const { t } = useTranslation('app');
  const membersQuery = useCohortMembers(cohort.id);
  const addMember = useAddCohortMember();
  const removeMember = useRemoveCohortMember();

  useEffect(() => {
    if (membersQuery.isError) onMessage(t('cohortMembersLoadFailed'));
  }, [membersQuery.isError, onMessage, t]);

  const members = membersQuery.data ?? [];

  /** Thêm thành viên vào cohort; backend kích hoạt đồng bộ ghi danh theo cohort. */
  async function addCohortMember() {
    const userId = input.trim();
    if (!userId) return;
    try {
      await addMember.mutateAsync({ cohortId: cohort.id, userId });
      onInputChange('');
      onMessage(t('cohortMemberAdded'));
    } catch {
      onMessage(t('cohortMemberAddFailed'));
    }
  }

  /** Gỡ thành viên khỏi cohort qua DELETE /cohorts/:id/members/:userId. */
  async function removeCohortMember(userId: string) {
    try {
      await removeMember.mutateAsync({ cohortId: cohort.id, userId });
      onMessage(t('cohortMemberRemoved'));
    } catch {
      onMessage(t('cohortMemberRemoveFailed'));
    }
  }

  return (
    <div className="space-y-2 rounded border p-3">
      <p className="text-sm font-medium">{t('cohortMembersTitle', { name: cohort.name })}</p>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 text-sm">
            <span>{t('cohortMemberLine', { userId: m.userId, time: m.timeAdded })}</span>
            {canManageCohorts && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void removeCohortMember(m.userId)}
              >
                {t('cohortRemoveMember')}
              </Button>
            )}
          </li>
        ))}
        {members.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('cohortNoMembers')}</li>
        )}
      </ul>
      {canManageCohorts && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`cohort-member-${cohort.id}`}>{t('cohortMemberUserId')}</Label>
            <Input
              id={`cohort-member-${cohort.id}`}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void addCohortMember()}>
            {t('cohortAddMember')}
          </Button>
        </div>
      )}
    </div>
  );
}
