import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import { useTranslation } from 'react-i18next';
import type { MessagingCourse, PeoplePickerContext, RosterMember } from '../types/types';
import { initialsOf } from '../utils/utils';

interface PeoplePickerProps {
  context: PeoplePickerContext;
  onSelectContext: (context: PeoplePickerContext) => void;
  classes: { classId: string; name: string }[];
  courses: MessagingCourse[];
  members: RosterMember[];
  rosterError: string | null;
  rosterCursor: string | null;
  onLoadMore: () => void;
  renderMemberAction?: (member: RosterMember) => ReactNode;
  selectedIds?: ReadonlySet<string>;
  onToggleMember?: (member: RosterMember) => void;
  contactEntries?: { userId: string; displayName: string }[];
  onToggleContactEntry?: (userId: string) => void;
}

export function PeoplePicker({
  context, onSelectContext, classes, courses, members, rosterError, rosterCursor,
  onLoadMore, renderMemberAction, selectedIds, onToggleMember,
  contactEntries, onToggleContactEntry,
}: PeoplePickerProps) {
  const { t } = useTranslation('app');
  const picking = Boolean(onToggleMember);

  const contextButton = (target: PeoplePickerContext, label: string) => {
    const isActive = context.kind === target.kind
      && (target.kind === 'contacts' || (context.kind !== 'contacts' && context.id === (target as { id: string }).id));
    return (
      <Button
        key={target.kind === 'contacts' ? 'contacts' : `${target.kind}-${(target as { id: string }).id}`}
        type="button"
        size="sm"
        variant={isActive ? 'default' : 'outline'}
        aria-pressed={isActive}
        onClick={() => onSelectContext(target)}
      >
        {label}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {contextButton({ kind: 'contacts' }, t('newMessageContactsContext'))}
        {classes.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('newMessagePickClass')}</p>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => contextButton({ kind: 'class', id: c.classId, name: c.name }, c.name))}
            </div>
          </div>
        ) : null}
        {courses.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('newMessagePickCourse')}</p>
            <div className="flex flex-wrap gap-1.5">
              {courses.map((c) => contextButton({ kind: 'course', id: c.courseId, name: c.fullName }, c.fullName))}
            </div>
          </div>
        ) : null}
      </div>
      {context.kind === 'contacts' && picking && contactEntries ? (
        <div className="space-y-2">
          {contactEntries.length > 0 ? (
            <ul className="space-y-1">
              {contactEntries.map((entry) => {
                const selected = selectedIds?.has(entry.userId) ?? false;
                return (
                  <li key={entry.userId} data-testid={`group-contact-${entry.userId}`}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/50', selected && 'bg-muted')}
                      onClick={() => onToggleContactEntry?.(entry.userId)}
                    >
                      <Avatar>
                        <AvatarFallback>{initialsOf(entry.displayName)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm">{entry.displayName}</span>
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noContacts')}</p>
          )}
        </div>
      ) : null}
      {context.kind !== 'contacts' ? (
        <div className="space-y-2">
          {rosterError ? <p role="alert" className="text-sm">{rosterError}</p> : null}
          {members.length > 0 ? (
            <ul className="space-y-1">
              {members.map((m) => {
                const selected = selectedIds?.has(m.userId) ?? false;
                const row = (
                  <>
                    <Avatar>
                      <AvatarFallback>{initialsOf(m.displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.displayName} <span className="text-muted-foreground">@{m.username}</span>
                    </span>
                    <Badge variant="secondary">
                      {m.role === 'teacher' ? t('rosterTeacher') : t('rosterStudent')}
                    </Badge>
                    {picking ? (
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                    ) : renderMemberAction?.(m)}
                  </>
                );
                return (
                  <li key={m.userId} data-testid={`roster-member-${m.userId}`}>
                    {picking ? (
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/50', selected && 'bg-muted')}
                        onClick={() => onToggleMember?.(m)}
                      >
                        {row}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 rounded-lg px-2 py-2.5">{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('rosterEmpty')}</p>
          )}
          {rosterCursor ? (
            <Button type="button" variant="outline" onClick={() => onLoadMore()}>
              {t('rosterLoadMore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
