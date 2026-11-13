import { useEffect } from 'react';
import type { CourseGroup, UserEnrolment } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { useTranslation } from 'react-i18next';
import { useAddCourseGroupMember, useCourseGroupMembers, useRemoveCourseGroupMember } from '../queries/course-admin';
import { ENROLMENT_STATUS } from '../types/course-admin';

/** Mảng thành viên của một nhóm khoá đang mở: tải khi mở lần đầu, thêm/gỡ qua đột biến rồi danh sách tự làm mới. */
export function GroupMembersSection({
  courseId,
  group,
  enrolments,
  canManageGroups,
  selection,
  onSelectionChange,
  onMessage,
}: {
  courseId: string;
  group: CourseGroup;
  enrolments: UserEnrolment[];
  canManageGroups: boolean;
  selection: string;
  onSelectionChange: (userId: string) => void;
  onMessage: (text: string) => void;
}) {
  const { t } = useTranslation('app');
  const membersQuery = useCourseGroupMembers(courseId, group.id);
  const addMember = useAddCourseGroupMember(courseId);
  const removeMember = useRemoveCourseGroupMember(courseId);

  useEffect(() => {
    if (membersQuery.isError) onMessage(t('groupMembersLoadFailed'));
  }, [membersQuery.isError, onMessage, t]);

  const members = membersQuery.data ?? [];
  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = enrolments.filter(
    (e, idx, all) =>
      e.status === ENROLMENT_STATUS.active && !memberIds.has(e.userId) && all.findIndex((x) => x.userId === e.userId) === idx,
  );

  /** Thêm một học sinh đã ghi danh vào nhóm; API chặn người chưa ghi danh hiệu lực (400 group.member_not_enrolled). */
  async function addGroupMember() {
    if (!selection) return;
    try {
      await addMember.mutateAsync({ groupId: group.id, userId: selection });
      onSelectionChange('');
      onMessage(t('groupMemberAdded'));
    } catch {
      onMessage(t('groupMemberAddFailed'));
    }
  }

  /** Gỡ thành viên khỏi nhóm (chỉ gỡ khỏi nhóm, ghi danh khoá giữ nguyên). */
  async function removeGroupMember(userId: string) {
    try {
      await removeMember.mutateAsync({ groupId: group.id, userId });
      onMessage(t('groupMemberRemoved'));
    } catch {
      onMessage(t('groupMemberRemoveFailed'));
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('groupMembersTitle', { name: group.name })}</p>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 text-sm">
            <span>{t('groupMemberLine', { userId: m.userId, time: m.timeAdded })}</span>
            {canManageGroups && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void removeGroupMember(m.userId)}
              >
                {t('groupRemoveMember')}
              </Button>
            )}
          </li>
        ))}
        {members.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('groupNoMembers')}</li>
        )}
      </ul>
      {canManageGroups && candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span id={`group-add-${group.id}-label`} className="text-sm font-medium">
              {t('groupAddMemberLabel')}
            </span>
            <Select
              items={Object.fromEntries([
                ['none', '—'],
                ...candidates.map((e) => [e.userId, e.userId] as [string, string]),
              ])}
              value={selection === '' ? 'none' : selection}
              onValueChange={(v) => onSelectionChange(!v || v === 'none' ? '' : v)}
            >
              <SelectTrigger aria-labelledby={`group-add-${group.id}-label`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {candidates.map((e) => (
                  <SelectItem key={e.userId} value={e.userId}>
                    {e.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void addGroupMember()}>
            {t('groupAddMember')}
          </Button>
        </div>
      )}
      {canManageGroups && candidates.length === 0 && members.length > 0 && (
        <p className="text-sm text-muted-foreground">{t('groupAllEnrolledInGroup')}</p>
      )}
    </div>
  );
}
