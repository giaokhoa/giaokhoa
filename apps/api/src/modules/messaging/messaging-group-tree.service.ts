import { badRequest, notFound } from '../../common/http-errors';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import type { ContactRelationship, PersonSummaryView } from './messaging-contacts.service';
import { MessagingMembershipSyncService } from './messaging-membership-sync.service';

export interface CourseRosterMemberView extends PersonSummaryView {
  role: 'teacher' | 'student';
  relationship: ContactRelationship;
  canDirectMessage: boolean;
}

export type ClassRosterMemberView = CourseRosterMemberView;

export interface MessagingCourseView {
  courseId: string;
  fullName: string;
  shortName: string;
}

export type ConversationTreeRole = 'teaching' | 'learning' | 'staff';

export interface ConversationTreeGroupView {
  groupId: string;
  name: string;
  myRole: ConversationTreeRole;
  conversationId: string | null;
  unread: number;
  pinnedAt: Date | null;
}

export interface ConversationTreeFreeGroupView {
  conversationId: string;
  name: string;
  myRole: ConversationTreeRole;
  unread: number;
  pinnedAt: Date | null;
}

export interface ConversationTreeCourseView {
  courseId: string;
  name: string;
  myRole: ConversationTreeRole;
  conversationId: string | null;
  unread: number;
  pinnedAt: Date | null;
  groups: ConversationTreeGroupView[];
}

export interface ConversationTreeClassView {
  classId: string;
  name: string;
  myRole: ConversationTreeRole;
  conversationId: string | null;
  unread: number;
  pinnedAt: Date | null;
  courses: ConversationTreeCourseView[];
}

export interface ConversationGroupTreeView {
  classes: ConversationTreeClassView[];
  coursesOutsideClasses: ConversationTreeCourseView[];
  freeGroups: ConversationTreeFreeGroupView[];
  canCreateFreeGroup: boolean;
}

export const ROSTER_DEFAULT_PAGE_SIZE = 50;

export const ROSTER_MAX_PAGE_SIZE = 100;

export class MessagingGroupTreeService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly membershipSync: MessagingMembershipSyncService,
  ) {}


  async listMyMessagingCourses(actorId: string): Promise<MessagingCourseView[]> {
    const courseIds = await this.repo.listMembershipCourseIds(actorId);
    const out: MessagingCourseView[] = [];
    for (const courseId of courseIds) {
      const summary = await this.repo.getCourseSummary(courseId);
      if (summary) out.push(summary);
    }
    return out.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.shortName.localeCompare(b.shortName));
  }

  async getGroupTree(actorId: string, canCreateFreeGroup: boolean): Promise<ConversationGroupTreeView> {
    for (const c of await this.repo.listGroupConversationsForGroupMember(actorId)) {
      await this.membershipSync.syncGroupConversationMembers(c);
    }
    for (const c of await this.repo.listCourseConversationsForMember(actorId)) {
      await this.membershipSync.syncCourseConversationMembers(c);
    }
    for (const c of await this.repo.listClassConversationsForMember(actorId)) {
      await this.membershipSync.syncClassConversationMembers(c);
    }

    const classRelations = await this.repo.listTreeClassesForUser(actorId);
    const myClassIds = new Set(classRelations.map((r) => r.classId));
    const membershipCourseIds = await this.repo.listMembershipCourseIds(actorId);
    const myCourseNameRows = await this.repo.listCourseNames(membershipCourseIds);
    const myCourseIds = new Set(myCourseNameRows.map((r) => r.courseId));
    const coursesInMyClasses = (await this.repo.listCoursesByClassIds([...myClassIds]))
      .filter((c) => myCourseIds.has(c.courseId));
    const parentRows = await this.repo.listClassesOfCourses(
      [...myCourseIds].filter((id) => !coursesInMyClasses.some((c) => c.courseId === id)),
    );
    const outsideCourseIds = parentRows
      .filter((r) => !myClassIds.has(r.classId) && r.classStatus === 'active')
      .map((r) => r.courseId);
    const detachedCourseIds = [...myCourseIds].filter((id) => !coursesInMyClasses.some((c) => c.courseId === id) && !parentRows.some((r) => r.courseId === id));
    const outsideAll = [...outsideCourseIds, ...detachedCourseIds];

    const allCourseIds = [...new Set([...coursesInMyClasses.map((c) => c.courseId), ...outsideAll])];
    const teachingIds = new Set(await this.repo.listTeachingCourseIds(actorId, allCourseIds));
    const nameOfCourse = new Map(myCourseNameRows.map((r) => [r.courseId, r.fullName]));

    const summaries = await this.repo.listConversationSummaries(actorId, {});
    const summariesArchived = await this.repo.listConversationSummaries(actorId, { archivedOnly: true });
    const unreadByConversation = new Map<string, number>();
    for (const s of [...summaries, ...summariesArchived]) {
      unreadByConversation.set(s.conversation.id, s.unreadCount);
    }
    const pinnedAtByConversation = new Map<string, Date | null>();
    for (const s of [...summaries, ...summariesArchived]) {
      pinnedAtByConversation.set(s.conversation.id, s.pinnedAt);
    }
    const courseConvByCourse = new Map(
      (await this.repo.listCourseConversationsByCourseIds(allCourseIds)).map((c) => [c.itemId!, c.id]),
    );
    const classConvByClass = new Map(
      (await this.repo.listClassConversations([...myClassIds])).map((c) => [c.itemId!, c.id]),
    );

    const myGroupIds = await this.repo.listGroupIdsForUser(actorId);
    const groupRows = (await this.repo.listGroupNames(myGroupIds))
      .filter((g) => allCourseIds.includes(g.courseId));
    const groupConvByGroup = new Map(
      (await this.repo.listGroupConversationsByGroupIds(groupRows.map((g) => g.groupId))).map((c) => [c.itemId!, c.id]),
    );

    const buildCourseNode = (courseId: string, name: string, myRole: ConversationTreeRole): ConversationTreeCourseView => {
      const convId = courseConvByCourse.get(courseId) ?? null;
      let unread = convId ? (unreadByConversation.get(convId) ?? 0) : 0;
      const groups: ConversationTreeGroupView[] = groupRows
        .filter((g) => g.courseId === courseId)
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        .map((g) => {
          const gConvId = groupConvByGroup.get(g.groupId) ?? null;
          const gUnread = gConvId ? (unreadByConversation.get(gConvId) ?? 0) : 0;
          unread += gUnread;
          return {
            groupId: g.groupId, name: g.name, myRole, conversationId: gConvId, unread: gUnread,
            pinnedAt: gConvId ? (pinnedAtByConversation.get(gConvId) ?? null) : null,
          };
        });
      return {
        courseId, name, myRole, conversationId: convId, unread,
        pinnedAt: convId ? (pinnedAtByConversation.get(convId) ?? null) : null,
        groups,
      };
    };

    const classNodes: ConversationTreeClassView[] = [];
    for (const rel of classRelations) {
      const myRole: ConversationTreeRole = rel.isOwner ? 'teaching' : rel.isClassStaff ? 'staff' : 'learning';
      const courseNodes = coursesInMyClasses
        .filter((c) => c.classId === rel.classId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
        .map((c) => buildCourseNode(
          c.courseId,
          c.fullName,
          teachingIds.has(c.courseId) || rel.isOwner || rel.isClassStaff ? 'teaching' : 'learning',
        ));
      const classConvId = classConvByClass.get(rel.classId) ?? null;
      const ownUnread = classConvId ? (unreadByConversation.get(classConvId) ?? 0) : 0;
      const totalUnread = ownUnread + courseNodes.reduce((sum, n) => sum + n.unread, 0);
      classNodes.push({
        classId: rel.classId, name: rel.name, myRole, conversationId: classConvId, unread: totalUnread,
        pinnedAt: classConvId ? (pinnedAtByConversation.get(classConvId) ?? null) : null,
        courses: courseNodes,
      });
    }
    classNodes.sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    const outsideNodes = outsideAll
      .sort((a, b) => (nameOfCourse.get(a) ?? '').localeCompare(nameOfCourse.get(b) ?? '', 'vi'))
      .map((courseId) => buildCourseNode(
        courseId,
        nameOfCourse.get(courseId) ?? courseId,
        teachingIds.has(courseId) ? 'teaching' : 'learning',
      ));

    const freeGroups: ConversationTreeFreeGroupView[] = [...summaries, ...summariesArchived]
      .filter((s) => s.conversation.type === 2 && !s.conversation.itemType)
      .sort((a, b) => b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime())
      .map((s) => ({
        conversationId: s.conversation.id,
        name: s.conversation.name ?? '',
        myRole: (s.conversation.createdBy === actorId ? 'staff' : 'learning') as ConversationTreeRole,
        unread: s.unreadCount,
        pinnedAt: s.pinnedAt,
      }));

    return { classes: classNodes, coursesOutsideClasses: outsideNodes, freeGroups, canCreateFreeGroup };
  }

  private decodeRosterCursor(raw: string): { displayName: string; username: string; userId: string } {
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
        d?: unknown; u?: unknown; i?: unknown;
      };
      if (typeof parsed.d !== 'string' || typeof parsed.u !== 'string' || typeof parsed.i !== 'string') {
        throw new Error('bad cursor shape');
      }
      return { displayName: parsed.d, username: parsed.u, userId: parsed.i };
    } catch {
      badRequest('Invalid roster cursor', 'messaging.roster_cursor_invalid');
    }
  }

  async listCourseRoster(actorId: string, courseId: string, query: { limit?: number; cursor?: string }): Promise<{
    members: CourseRosterMemberView[];
    nextCursor: string | null;
  }> {
    const course = await this.repo.getCourseSummary(courseId);
    if (!course || !(await this.repo.isCourseMember(courseId, actorId))) {
      notFound('Course not found', 'messaging.course_not_found');
    }
    const limit = Math.min(Math.max(query.limit ?? ROSTER_DEFAULT_PAGE_SIZE, 1), ROSTER_MAX_PAGE_SIZE);
    const cursor = query.cursor ? this.decodeRosterCursor(query.cursor) : null;
    const rows = await this.repo.listCourseRosterPage(courseId, actorId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const [contactIds, incoming, outgoing, viewerIsTeacher] = await Promise.all([
      this.repo.listContacts(actorId),
      this.repo.listIncomingContactRequests(actorId),
      this.repo.listOutgoingContactRequests(actorId),
      this.repo.isCourseTeachingStaff(courseId, actorId),
    ]);
    const contactSet = new Set(contactIds);
    const incomingSet = new Set(incoming.map((r) => r.userIdFrom));
    const outgoingSet = new Set(outgoing.map((r) => r.userIdTo));
    const relationshipOf = (id: string): ContactRelationship => {
      if (contactSet.has(id)) return 'contact';
      if (incomingSet.has(id)) return 'pending_incoming';
      if (outgoingSet.has(id)) return 'pending_outgoing';
      return 'none';
    };
    const members = page.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      username: row.username,
      role: (row.staff ? 'teacher' : 'student') as 'teacher' | 'student',
      relationship: relationshipOf(row.userId),
      canDirectMessage: viewerIsTeacher && row.enrolled,
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ d: last.displayName, u: last.username, i: last.userId }), 'utf8').toString('base64url')
      : null;
    return { members, nextCursor };
  }

  async listClassRoster(actorId: string, classId: string, query: { limit?: number; cursor?: string }): Promise<{
    members: ClassRosterMemberView[];
    nextCursor: string | null;
  }> {
    const cls = await this.repo.getClassSummary(classId);
    if (!cls || cls.status !== 'active' || !(await this.repo.isClassMember(classId, actorId))) {
      notFound('Class not found', 'messaging.class_not_found');
    }
    const limit = Math.min(Math.max(query.limit ?? ROSTER_DEFAULT_PAGE_SIZE, 1), ROSTER_MAX_PAGE_SIZE);
    const cursor = query.cursor ? this.decodeRosterCursor(query.cursor) : null;
    const rows = await this.repo.listClassRosterPage(classId, actorId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const [contactIds, incoming, outgoing, viewerIsTeacher] = await Promise.all([
      this.repo.listContacts(actorId),
      this.repo.listIncomingContactRequests(actorId),
      this.repo.listOutgoingContactRequests(actorId),
      this.repo.isClassTeachingStaff(classId, actorId),
    ]);
    const contactSet = new Set(contactIds);
    const incomingSet = new Set(incoming.map((r) => r.userIdFrom));
    const outgoingSet = new Set(outgoing.map((r) => r.userIdTo));
    const relationshipOf = (id: string): ContactRelationship => {
      if (contactSet.has(id)) return 'contact';
      if (incomingSet.has(id)) return 'pending_incoming';
      if (outgoingSet.has(id)) return 'pending_outgoing';
      return 'none';
    };
    const members = page.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      username: row.username,
      role: (row.staff ? 'teacher' : 'student') as 'teacher' | 'student',
      relationship: relationshipOf(row.userId),
      canDirectMessage: viewerIsTeacher && row.enrolled,
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ d: last.displayName, u: last.username, i: last.userId }), 'utf8').toString('base64url')
      : null;
    return { members, nextCursor };
  }
}
