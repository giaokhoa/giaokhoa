import { useState } from 'react';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@giaokhoa/ui/components/sheet';
import { useTranslation } from 'react-i18next';
import { PeoplePicker } from './people-picker';
import type {
  MessagingCourse,
  PeoplePickerContext,
  RosterMember,
} from '../types/types';

interface CreateGroupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (name: string, memberIds: string[]) => void;
  createError: string | null;
  pickerContext: PeoplePickerContext;
  onSelectPickerContext: (context: PeoplePickerContext) => void;
  pickerClasses: { classId: string; name: string }[];
  pickerCourses: MessagingCourse[];
  pickerMembers: RosterMember[];
  pickerRosterError: string | null;
  pickerRosterCursor: string | null;
  onLoadMorePicker: () => void;
  contactEntries: { userId: string; displayName: string }[];
}

export function CreateGroupSheet({
  open, onOpenChange, onCreateGroup, createError, pickerContext, onSelectPickerContext,
  pickerClasses, pickerCourses, pickerMembers, pickerRosterError, pickerRosterCursor,
  onLoadMorePicker, contactEntries,
}: CreateGroupSheetProps) {
  const { t } = useTranslation('app');
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setName('');
      setSelectedIds(new Set());
    }
  }

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const canSubmit = name.trim().length > 0 && selectedIds.size > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('createGroupTitle')}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="msg-t3-group-name">{t('groupNameLabel')}</Label>
            <Input
              id="msg-t3-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('groupNamePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <h3 className="font-medium">{t('groupPickMembers')}</h3>
            <PeoplePicker
              context={pickerContext}
              onSelectContext={onSelectPickerContext}
              classes={pickerClasses}
              courses={pickerCourses}
              members={pickerMembers}
              rosterError={pickerRosterError}
              rosterCursor={pickerRosterCursor}
              onLoadMore={onLoadMorePicker}
              selectedIds={selectedIds}
              onToggleMember={(m) => toggle(m.userId)}
              contactEntries={contactEntries}
              onToggleContactEntry={toggle}
            />
          </div>
          {selectedIds.size === 0 ? (
            <p className="text-sm text-muted-foreground">{t('groupNeedMember')}</p>
          ) : null}
          {createError ? <p role="alert" className="text-sm">{createError}</p> : null}
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => onCreateGroup(name.trim(), [...selectedIds])}
          >
            {t('createGroupTitle')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
