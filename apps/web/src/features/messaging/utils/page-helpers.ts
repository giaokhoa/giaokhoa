import type {
  ConversationGroupTreeView,
  ConversationTreeClassView,
  ConversationTreeCourseView,
  ConversationView,
  MemberPanelContext,
  MessagingCourse,
} from '../types/types';

const MESSAGES_TAB_STORAGE_KEY = 'giaokhoa.messages.tab';
const MESSAGES_CONVERSATION_STORAGE_KEY = 'giaokhoa.messages.conversationId';
const MESSAGES_TABS = ['all', 'unread', 'groups', 'archived'] as const;

export function readStoredMessagesTab(): string {
  if (typeof window === 'undefined') return 'all';
  try {
    const raw = window.localStorage.getItem(MESSAGES_TAB_STORAGE_KEY);
    return raw && (MESSAGES_TABS as readonly string[]).includes(raw) ? raw : 'all';
  } catch {
    return 'all';
  }
}

export function readStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MESSAGES_CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeMessagesTab(tab: string) {
  try {
    window.localStorage.setItem(MESSAGES_TAB_STORAGE_KEY, tab);
  } catch {
  }
}

export function storeConversationId(conversationId: string | null) {
  try {
    if (conversationId) window.localStorage.setItem(MESSAGES_CONVERSATION_STORAGE_KEY, conversationId);
    else window.localStorage.removeItem(MESSAGES_CONVERSATION_STORAGE_KEY);
  } catch {
  }
}
export function withTreeUnread(
  tree: ConversationGroupTreeView | null,
  conversationId: string,
  unreadCount: number,
): ConversationGroupTreeView | null {
  if (!tree) return tree;
  const patchCourse = (course: ConversationTreeCourseView): ConversationTreeCourseView => {
    const groups = course.groups.map((g) => (g.conversationId === conversationId ? { ...g, unread: unreadCount } : g));
    const own =
      course.conversationId === conversationId
        ? unreadCount
        : course.unread - course.groups.reduce((sum, g) => sum + g.unread, 0);
    return { ...course, groups, unread: own + groups.reduce((sum, g) => sum + g.unread, 0) };
  };
  const patchClass = (cls: ConversationTreeClassView): ConversationTreeClassView => {
    const courses = cls.courses.map(patchCourse);
    const own =
      cls.conversationId === conversationId
        ? unreadCount
        : cls.unread - cls.courses.reduce((sum, c) => sum + c.unread, 0);
    return { ...cls, courses, unread: own + courses.reduce((sum, c) => sum + c.unread, 0) };
  };
  return {
    classes: tree.classes.map(patchClass),
    coursesOutsideClasses: tree.coursesOutsideClasses.map(patchCourse),
    freeGroups: tree.freeGroups.map((g) => (g.conversationId === conversationId ? { ...g, unread: unreadCount } : g)),
    canCreateFreeGroup: tree.canCreateFreeGroup,
  };
}

export function withConversationMovedToSectionTop(
  list: ConversationView[],
  conversationId: string,
  update: (conversation: ConversationView) => ConversationView,
): ConversationView[] {
  const target = list.find((c) => c.id === conversationId);
  if (!target) return list;
  const updated = update(target);
  const rest = list.filter((c) => c.id !== conversationId);
  if (updated.pinnedAt) return [updated, ...rest];
  const pinnedCount = rest.filter((c) => c.pinnedAt).length;
  return [...rest.slice(0, pinnedCount), updated, ...rest.slice(pinnedCount)];
}

export function memberPanelContextOf(
  conv: ConversationView,
  tree: ConversationGroupTreeView | null,
  courses: MessagingCourse[],
): MemberPanelContext | null {
  if (conv.type !== 2) return null;
  if (conv.itemType === 'class' && conv.itemId) {
    const node = tree?.classes.find((c) => c.classId === conv.itemId);
    return { kind: 'class', id: conv.itemId, name: node?.name ?? conv.name ?? '' };
  }
  if (conv.itemType === 'course' && conv.itemId) {
    for (const cls of tree?.classes ?? []) {
      const node = cls.courses.find((c) => c.courseId === conv.itemId);
      if (node) return { kind: 'course', id: conv.itemId, name: node.name, parentName: cls.name };
    }
    const outside = tree?.coursesOutsideClasses.find((c) => c.courseId === conv.itemId);
    if (outside) return { kind: 'course', id: conv.itemId, name: outside.name };
    const course = courses.find((c) => c.courseId === conv.itemId);
    return { kind: 'course', id: conv.itemId, name: course?.fullName ?? conv.name ?? '' };
  }
  if (conv.itemType === 'groups' && conv.itemId) {
    const classes = tree?.classes ?? [];
    for (const cls of classes) {
      for (const course of cls.courses) {
        if (course.groups.some((g) => g.groupId === conv.itemId)) {
          return { kind: 'course', id: course.courseId, name: course.name, parentName: cls.name, subgroup: true };
        }
      }
    }
    for (const course of tree?.coursesOutsideClasses ?? []) {
      if (course.groups.some((g) => g.groupId === conv.itemId)) {
        return { kind: 'course', id: course.courseId, name: course.name, subgroup: true };
      }
    }
    return null;
  }
  return { kind: 'free', name: conv.name ?? '' };
}
