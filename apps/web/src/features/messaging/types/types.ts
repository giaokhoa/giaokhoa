
export type ScrollerHandle = { scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior }) => boolean };
export interface MessageQuoteView {
  id: string;
  seq: number;
  userIdFrom: string;
  excerpt: string;
  unavailable: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  userIdFrom: string;
  fullMessage: string;
  createdAt: string;
  seq: number;
  clientMessageId: string | null;
  replyToMessageId?: string | null;
  replyTo?: MessageQuoteView | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  recalledAt?: string | null;
  recalledBy?: string | null;
  localStatus?: 'sending' | 'failed';
}
export interface MessageSearchResultView {
  id: string;
  conversationId: string;
  userIdFrom: string;
  seq: number;
  excerpt: string;
  createdAt: string;
}
export interface ConversationStatePatch {
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
}

export interface ConversationStateView {
  conversationId: string;
  pinned: boolean;
  pinnedAt: string | null;
  archived: boolean;
  archivedAt: string | null;
  muted: boolean;
}

export interface PersonSummary {
  userId: string;
  displayName: string;
  username: string;
}
export type ContactRelationship = 'contact' | 'pending_incoming' | 'pending_outgoing' | 'blocked' | 'none';

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';
export interface MessagingCourse {
  courseId: string;
  fullName: string;
  shortName: string;
}
export interface RosterMember extends PersonSummary {
  role: 'teacher' | 'student';
  relationship: ContactRelationship;
  canDirectMessage?: boolean;
}
export interface ContactRequestView {
  userId: string;
  createdAt: string;
  displayName?: string;
  username?: string;
}
export interface ConversationView {
  id: string;
  type: number;
  name: string | null;
  component?: string | null;
  itemType?: string | null;
  itemId?: string | null;
  members: string[];
  memberProfiles?: Record<string, PersonSummary>;
  unread?: number;
  lastReadSeq?: number;
  lastMessageSeq?: number;
  lastMessage?: MessageView | null;
  enabled?: boolean;
  pinnedAt?: string | null;
  archivedAt?: string | null;
  muted?: boolean;
  createdBy?: string | null;
  canModerate?: boolean;
  canManage?: boolean;
}
export interface ConversationDetailView extends ConversationView {
  messages: MessageView[];
  hasMoreBefore?: boolean;
  memberReadMarkers?: { userId: string; lastReadSeq: number }[];
}

export type ConversationTreeRoleView = 'teaching' | 'learning' | 'staff';

export interface ConversationTreeGroupView {
  groupId: string;
  name: string;
  myRole: ConversationTreeRoleView;
  conversationId: string | null;
  unread: number;
  pinnedAt: string | null;
}

export interface ConversationTreeFreeGroupView {
  conversationId: string;
  name: string;
  myRole: ConversationTreeRoleView;
  unread: number;
  pinnedAt: string | null;
}

export interface ConversationTreeCourseView {
  courseId: string;
  name: string;
  myRole: ConversationTreeRoleView;
  conversationId: string | null;
  unread: number;
  pinnedAt: string | null;
  groups: ConversationTreeGroupView[];
}

export interface ConversationTreeClassView {
  classId: string;
  name: string;
  myRole: ConversationTreeRoleView;
  conversationId: string | null;
  unread: number;
  pinnedAt: string | null;
  courses: ConversationTreeCourseView[];
}

export interface ConversationGroupTreeView {
  classes: ConversationTreeClassView[];
  coursesOutsideClasses: ConversationTreeCourseView[];
  freeGroups: ConversationTreeFreeGroupView[];
  canCreateFreeGroup: boolean;
}

export type MemberPanelContext =
  | { kind: 'class'; id: string; name: string; parentName?: string }
  | { kind: 'course'; id: string; name: string; parentName?: string; subgroup?: boolean }
  | { kind: 'free'; name: string };

export interface MemberPanelEntry extends PersonSummary {
  role: 'teacher' | 'student' | 'admin' | 'member';
  relationship: ContactRelationship;
  canDirectMessage: boolean;
  isCreator?: boolean;
}

export type PeoplePickerContext =
  | { kind: 'contacts' }
  | { kind: 'class'; id: string; name: string }
  | { kind: 'course'; id: string; name: string };
