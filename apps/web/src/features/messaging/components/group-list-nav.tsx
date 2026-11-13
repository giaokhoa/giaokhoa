import { useState, type ReactNode } from 'react';
import { BellOff, ChevronDown, Plus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@giaokhoa/ui/components/collapsible';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { cn } from '@giaokhoa/ui/lib/utils';
import { useTranslation } from 'react-i18next';
import type {
  ConversationGroupTreeView,
  ConversationTreeClassView,
  ConversationTreeCourseView,
  ConversationTreeRoleView,
  ConversationView,
} from '../types/types';
import { initialsOf, relativeTime } from '../utils/utils';

interface GroupListNavProps {
  tree: ConversationGroupTreeView | null;
  filter: string;
  activeConversationId: string | null;
  onOpenConversationById: (conversationId: string) => void;
  onOpenClassChat: (classId: string) => void;
  onOpenCourseChat: (courseId: string) => void;
  onOpenGroupConversation: (groupId: string) => void;
  canCreateFreeGroup: boolean;
  onCreateFreeGroup: () => void;
  conversationsById?: ReadonlyMap<string, ConversationView>;
  myId?: string;
  nameOf?: (userId: string) => string;
  loading?: boolean;
  treeError?: string | null;
}

export function countGroupListEntries(tree: ConversationGroupTreeView): number {
  const countCourse = (course: ConversationTreeCourseView) => 1 + course.groups.length;
  return tree.classes.reduce((sum, cls) => sum + 1 + cls.courses.reduce((s, c) => s + countCourse(c), 0), 0)
    + tree.coursesOutsideClasses.reduce((sum, c) => sum + countCourse(c), 0)
    + tree.freeGroups.length;
}

function GroupUnreadBadge({ count }: { count: number }) {
  const { t } = useTranslation('app');
  if (count <= 0) return null;
  return (
    <>
      <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1 tabular-nums">{count}</Badge>
      <span className="sr-only">{t('unreadSuffix', { count })}</span>
    </>
  );
}

interface GroupListEntry {
  key: string;
  label: string;
  role: ConversationTreeRoleView;
  unread: number;
  conversationId: string | null;
  pinnedAt: string | null;
  depth: number;
  onOpen: () => void;
}

export function GroupListNav({
  tree, filter, activeConversationId, onOpenConversationById, onOpenClassChat,
  onOpenCourseChat, onOpenGroupConversation, canCreateFreeGroup, onCreateFreeGroup,
  conversationsById, myId, nameOf, loading, treeError,
}: GroupListNavProps) {
  const { t } = useTranslation('app');
  const [pinnedSectionOpen, setPinnedSectionOpen] = useState(true);
  const [groupsSectionOpen, setGroupsSectionOpen] = useState(true);

  if (!tree) {
    if (treeError) {
      return <p role="alert" className="px-2 text-sm">{treeError}</p>;
    }
    if (loading) {
      return (
        <div data-testid="group-list-loading" className="space-y-2 px-2" aria-label={t('conversationsLoading')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      );
    }
    return <p className="px-2 text-sm text-muted-foreground">{t('groupTreeEmpty')}</p>;
  }

  const needle = filter.trim().toLocaleLowerCase('vi');
  const matches = (name: string) => !needle || name.toLocaleLowerCase('vi').includes(needle);
  const filterCourse = (course: ConversationTreeCourseView): ConversationTreeCourseView | null => {
    if (matches(course.name)) return course;
    const groups = course.groups.filter((g) => matches(g.name));
    return groups.length > 0 ? { ...course, groups } : null;
  };
  const filterClass = (cls: ConversationTreeClassView): ConversationTreeClassView | null => {
    if (matches(cls.name)) return cls;
    const courses = cls.courses.map(filterCourse).filter((c): c is ConversationTreeCourseView => c !== null);
    return courses.length > 0 ? { ...cls, courses } : null;
  };
  const classes = tree.classes.map(filterClass).filter((c): c is ConversationTreeClassView => c !== null);
  const outsideCourses = tree.coursesOutsideClasses
    .map(filterCourse)
    .filter((c): c is ConversationTreeCourseView => c !== null);
  const freeGroups = tree.freeGroups.filter((g) => matches(g.name));

  const courseEntries = (course: ConversationTreeCourseView, depth: number): GroupListEntry[] => [
    {
      key: `course-${course.courseId}`,
      label: course.name,
      role: course.myRole,
      unread: course.unread,
      conversationId: course.conversationId,
      pinnedAt: course.pinnedAt,
      depth,
      onOpen: () => onOpenCourseChat(course.courseId),
    },
    ...course.groups.map((g): GroupListEntry => ({
      key: `group-${g.groupId}`,
      label: g.name,
      role: g.myRole,
      unread: g.unread,
      conversationId: g.conversationId,
      pinnedAt: g.pinnedAt,
      depth: depth + 1,
      onOpen: () => (g.conversationId ? onOpenConversationById(g.conversationId) : onOpenGroupConversation(g.groupId)),
    })),
  ];
  const classEntries = classes.flatMap((cls): GroupListEntry[] => [
    {
      key: `class-${cls.classId}`,
      label: cls.name,
      role: cls.myRole,
      unread: cls.unread,
      conversationId: cls.conversationId,
      pinnedAt: cls.pinnedAt,
      depth: 0,
      onOpen: () => onOpenClassChat(cls.classId),
    },
    ...cls.courses.flatMap((course) => courseEntries(course, 1)),
  ]);
  const outsideEntries = outsideCourses.flatMap((course) => courseEntries(course, 0));
  const freeEntries = freeGroups.map((g): GroupListEntry => ({
    key: `free-${g.conversationId}`,
    label: g.name,
    role: g.myRole,
    unread: g.unread,
    conversationId: g.conversationId,
    pinnedAt: g.pinnedAt,
    depth: 0,
    onOpen: () => onOpenConversationById(g.conversationId),
  }));
  const nothingVisible = classEntries.length === 0 && outsideEntries.length === 0 && freeEntries.length === 0;

  const roleLabel = (role: ConversationTreeRoleView) => (role === 'teaching'
    ? t('treeRoleTeaching')
    : role === 'learning'
      ? t('treeRoleLearning')
      : t('treeRoleStaff'));

  const renderEntry = (entry: GroupListEntry) => {
    const conversation = entry.conversationId ? conversationsById?.get(entry.conversationId) : undefined;
    const lastMessage = conversation?.lastMessage ?? null;
    const isActive = entry.conversationId !== null && entry.conversationId === activeConversationId;
    return (
      <button
        key={entry.key}
        type="button"
        aria-current={isActive || undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg py-2.5 pr-2.5 text-left ring-inset transition-colors',
          isActive ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/75',
        )}
        style={{ paddingLeft: `${0.625 + entry.depth * 1.25}rem` }}
        onClick={entry.onOpen}
      >
        <Avatar size="lg">
          <AvatarFallback className={cn(isActive && 'bg-background/50')}>{initialsOf(entry.label)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.label}</span>
            {lastMessage ? (
              <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">
                {relativeTime(lastMessage.createdAt, t)}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {lastMessage ? (
              <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
                {lastMessage.userIdFrom === myId
                  ? `${t('lastMessageOwnPrefix')} `
                  : `${nameOf?.(lastMessage.userIdFrom) ?? lastMessage.userIdFrom}: `}
                {lastMessage.fullMessage}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{roleLabel(entry.role)}</span>
            )}
            {conversation?.muted ? (
              <span className="grid size-5 shrink-0 place-items-center">
                <BellOff data-testid={`conversation-muted-${conversation.id}`} className="size-3 text-muted-foreground" aria-hidden />
              </span>
            ) : null}
          </span>
        </span>
        <GroupUnreadBadge count={entry.unread} />
      </button>
    );
  };

  const isPinnedEntry = (entry: GroupListEntry): boolean => Boolean(entry.pinnedAt);
  const pinnedClassEntries = classEntries.filter(isPinnedEntry);
  const pinnedOutsideEntries = outsideEntries.filter(isPinnedEntry);
  const pinnedFreeEntries = freeEntries.filter(isPinnedEntry);
  const pinnedEntries = [...pinnedClassEntries, ...pinnedOutsideEntries, ...pinnedFreeEntries];
  const restClassEntries = classEntries.filter((e) => !isPinnedEntry(e));
  const restOutsideEntries = outsideEntries.filter((e) => !isPinnedEntry(e));
  const restFreeEntries = freeEntries.filter((e) => !isPinnedEntry(e));
  const restCount = restClassEntries.length + restOutsideEntries.length + restFreeEntries.length;

  const renderCreateGroupButton = () => (canCreateFreeGroup ? (
    <div className="flex items-center justify-end px-2 pt-1">
      <Button type="button" size="sm" variant="outline" onClick={onCreateFreeGroup}>
        <Plus className="size-4" />
        {t('createGroupTitle')}
      </Button>
    </div>
  ) : null);

  const renderGroupSection = (
    title: string,
    open: boolean,
    onOpenChange: (next: boolean) => void,
    children: ReactNode,
  ) => (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 pb-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <span>{title}</span>
        <ChevronDown aria-hidden className={cn('ml-auto size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>{open ? children : null}</CollapsibleContent>
    </Collapsible>
  );

  const emptyNotice = nothingVisible ? (
    <p className="px-2 text-sm text-muted-foreground">
      {needle ? t('groupTreeNoResults') : t('groupTreeEmpty')}
    </p>
  ) : null;

  if (pinnedEntries.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {classEntries.map(renderEntry)}
        {outsideEntries.map(renderEntry)}
        {renderCreateGroupButton()}
        {freeEntries.map(renderEntry)}
        {emptyNotice}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {renderGroupSection(
        t('messagesPinnedSection'),
        pinnedSectionOpen,
        setPinnedSectionOpen,
        <div className="flex flex-col gap-1">{pinnedEntries.map(renderEntry)}</div>,
      )}
      {restCount > 0 || canCreateFreeGroup ? renderGroupSection(
        t('messagesTabGroups'),
        groupsSectionOpen,
        setGroupsSectionOpen,
        <div className="flex flex-col gap-1">
          {restClassEntries.map(renderEntry)}
          {restOutsideEntries.map(renderEntry)}
          {renderCreateGroupButton()}
          {restFreeEntries.map(renderEntry)}
        </div>,
      ) : null}
      {emptyNotice}
    </div>
  );
}
