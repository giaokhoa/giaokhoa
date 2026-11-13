import { useEffect } from 'react';
import type { CourseGroup, CourseGrouping } from '@giaokhoa/contracts';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@giaokhoa/ui/components/select';
import { useTranslation } from 'react-i18next';
import { useAddGroupToGrouping, useCourseGroupingGroups } from '../queries/course-admin';

/** Mảng các nhóm trong một grouping đang mở: tải khi mở lần đầu, gắn nhóm qua đột biến rồi danh sách tự làm mới. */
export function GroupingGroupsSection({
  courseId,
  grouping,
  groups,
  selection,
  onSelectionChange,
  onMessage,
}: {
  courseId: string;
  grouping: CourseGrouping;
  groups: CourseGroup[];
  selection: string;
  onSelectionChange: (groupId: string) => void;
  onMessage: (text: string) => void;
}) {
  const { t } = useTranslation('app');
  const groupsQuery = useCourseGroupingGroups(courseId, grouping.id);
  const addGroup = useAddGroupToGrouping(courseId);

  useEffect(() => {
    if (groupsQuery.isError) onMessage(t('groupingGroupsLoadFailed'));
  }, [groupsQuery.isError, onMessage, t]);

  const inGrouping = groupsQuery.data ?? [];
  const candidates = groups.filter((gr) => !inGrouping.some((x) => x.id === gr.id));

  /** Gắn một nhóm vào grouping qua POST groupings/:groupingId/groups với `{ groupId }`. */
  async function addGroupToGrouping() {
    if (!selection) return;
    try {
      await addGroup.mutateAsync({ groupingId: grouping.id, groupId: selection });
      onMessage(t('groupingGroupAdded'));
    } catch {
      onMessage(t('groupingGroupAddFailed'));
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('groupingGroupsTitle', { name: grouping.name })}</p>
      <ul className="space-y-1">
        {inGrouping.map((gr) => (
          <li key={gr.id} className="text-sm">
            {gr.name}
          </li>
        ))}
        {inGrouping.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('groupingNoGroups')}</li>
        )}
      </ul>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span id={`grouping-add-${grouping.id}-label`} className="text-sm font-medium">
              {t('groupingAddGroupLabel')}
            </span>
            <Select
              items={Object.fromEntries([
                ['none', '—'],
                ...candidates.map((gr) => [gr.id, gr.name] as [string, string]),
              ])}
              value={selection === '' ? 'none' : selection}
              onValueChange={(v) => onSelectionChange(!v || v === 'none' ? '' : v)}
            >
              <SelectTrigger aria-labelledby={`grouping-add-${grouping.id}-label`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {candidates.map((gr) => (
                  <SelectItem key={gr.id} value={gr.id}>
                    {gr.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void addGroupToGrouping()}>
            {t('groupingAddGroup')}
          </Button>
        </div>
      )}
    </div>
  );
}
