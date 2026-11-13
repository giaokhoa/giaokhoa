import { Injectable } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import { sql } from '@giaokhoa/db';
import { NotificationDeliveryService } from './notification-delivery.service';
import { SpaceDatabaseService } from './db/routing/space-database.service';

export const NOTIFICATION_EVENT_TYPES = [
  'grade_updated',
  'course_completed',
  'enrol_expiry_warning',
  'message_sent',
  'activity_due_reminder',
  'assignment_created',
  'assignment_submitted',
  'assignment_returned',
  'exam_pinned',
  'quiz_attempt_finished',
] as const;

const NON_NOTIFIED_ITEM_TYPES = new Set(['course', 'category', 'calculated']);

const STAFF_ARCHETYPES = ['manager', 'coursecreator', 'editingteacher', 'teacher'] as const;

function displayNameOf(user: { firstName: string; lastName: string; username: string }): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}

@Injectable()
export class NotificationEventsHandlerService {
  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly delivery: NotificationDeliveryService,
    private readonly i18n: I18nService,
  ) {}

  async handle(type: string, payload: Record<string, unknown>): Promise<boolean> {
    if (type === 'grade_updated') { await this.handleGradeUpdated(payload); return true; }
    if (type === 'course_completed') { await this.handleCourseCompleted(payload); return true; }
    if (type === 'enrol_expiry_warning') { await this.handleEnrolExpiryWarning(payload); return true; }
    if (type === 'message_sent') { await this.handleMessageSent(payload); return true; }
    if (type === 'activity_due_reminder') { await this.handleActivityDueReminder(payload); return true; }
    if (type === 'assignment_created') { await this.handleAssignmentCreated(payload); return true; }
    if (type === 'assignment_submitted') { await this.handleAssignmentSubmitted(payload); return true; }
    if (type === 'assignment_returned') { await this.handleAssignmentReturned(payload); return true; }
    if (type === 'exam_pinned') { await this.handlePinCreated(payload); return true; }
    if (type === 'quiz_attempt_finished') { await this.handleQuizAttemptFinished(payload); return true; }
    return false;
  }

  private async handleGradeUpdated(payload: Record<string, unknown>): Promise<void> {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : null;
    const finalGrade = typeof payload.finalGrade === 'number' ? payload.finalGrade : null;
    if (!userId || !itemId || finalGrade === null) return;
    const item = await this.getGradeItemNotifyInfo(itemId);
    if (!item || item.hidden || NON_NOTIFIED_ITEM_TYPES.has(item.itemType)) return;
    if (await this.isGradeHiddenForUser(itemId, userId)) return;
    const courseName = (await this.getCourseFullName(item.courseId)) ?? '';
    const itemName = item.itemName || courseName;
    await this.delivery.notify(userId, 'grade_updated', {
      subject: this.t('platform.gradeUpdatedSubject', { course: courseName }),
      body: this.t('platform.gradeUpdatedBody', { course: courseName, item: itemName }),
      contextUrl: `/courses/${item.courseId}/grades`,
      courseId: item.courseId,
      tenantId: await this.resolveCourseTenantId(payload, item.courseId, userId),
    });
  }

  private async handleCourseCompleted(payload: Record<string, unknown>): Promise<void> {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    if (!userId || !courseId) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    await this.delivery.notify(userId, 'course_completed', {
      subject: this.t('platform.courseCompletedSubject', { course: courseName }),
      body: this.t('platform.courseCompletedBody', { course: courseName }),
      contextUrl: `/courses/${courseId}`,
      courseId,
      tenantId: await this.resolveCourseTenantId(payload, courseId, userId),
    });
  }

  private async handleEnrolExpiryWarning(payload: Record<string, unknown>): Promise<void> {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const timeEnd = typeof payload.timeEnd === 'string' ? payload.timeEnd : null;
    if (!userId || !courseId || !timeEnd) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const date = new Date(timeEnd);
    const dateText = Number.isNaN(date.getTime()) ? timeEnd : date.toLocaleDateString('vi-VN');
    await this.delivery.notify(userId, 'enrol_expiry_warning', {
      subject: this.t('platform.enrolExpiryWarningSubject', { course: courseName }),
      body: this.t('platform.enrolExpiryWarningBody', { course: courseName, date: dateText }),
      contextUrl: `/courses/${courseId}`,
      courseId,
      tenantId: await this.resolveCourseTenantId(payload, courseId, userId),
    });
  }

  private async handleActivityDueReminder(payload: Record<string, unknown>): Promise<void> {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const timeClose = typeof payload.timeClose === 'string' ? payload.timeClose : null;
    if (!userId || !courseId || !timeClose) return;
    const isAssign = payload.activityType === 'assign';
    const pinId = typeof payload.pinId === 'string' ? payload.pinId : null;
    const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : null;
    if (!isAssign && !pinId) return;
    if (isAssign && !assignmentId) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const activityName = typeof payload.activityName === 'string' && payload.activityName ? payload.activityName : courseName;
    const date = new Date(timeClose);
    const dateText = Number.isNaN(date.getTime()) ? timeClose : date.toLocaleString('vi-VN');
    await this.delivery.notify(userId, 'activity_due_soon', {
      subject: this.t('platform.activityDueSoonSubject', { activity: activityName }),
      body: this.t('platform.activityDueSoonBody', { activity: activityName, course: courseName, datetime: dateText }),
      contextUrl: isAssign
        ? `/courses/${courseId}/assignments/${assignmentId}`
        : `/courses/${courseId}/exams/${pinId}`,
      courseId,
      tenantId: await this.resolveCourseTenantId(payload, courseId, userId),
    });
  }

  private isVisibleToStudents(info: {
    courseVisible: boolean;
    cmVisible: boolean | null;
    cmDeletionInProgress: boolean | null;
  }): boolean {
    return info.courseVisible && info.cmVisible !== false && info.cmDeletionInProgress !== true;
  }

  private async notifyGrouped(
    userId: string,
    provider: string,
    contextUrl: string,
    subject: string,
    body: string,
    courseId: string,
  ): Promise<void> {
    const existing = await this.getUnreadNotification(userId, provider, contextUrl);
    if (existing) {
      if (existing.subject !== subject || existing.fullMessage !== body) {
        await this.updateNotificationContent(existing.id, subject, body);
      }
      return;
    }
    await this.delivery.notify(userId, provider, {
      subject,
      body,
      contextUrl,
      courseId,
      tenantId: await this.getUserDefaultTenantId(userId),
    });
  }

  private async handleAssignmentCreated(payload: Record<string, unknown>): Promise<void> {
    const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const actorId = typeof payload.actorId === 'string' ? payload.actorId : null;
    if (!assignmentId || !courseId) return;
    const info = await this.getAssignmentNotifyInfo(assignmentId);
    if (!info || !this.isVisibleToStudents(info)) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const contextUrl = `/courses/${courseId}/assignments/${assignmentId}`;
    const studentIds = await this.listActiveEnrolledUserIds(courseId);
    for (const studentId of studentIds) {
      if (studentId === actorId) continue;
      await this.notifyGrouped(
        studentId,
        'assignment_assigned',
        contextUrl,
        this.t('platform.assignmentAssignedSubject', { assignment: info.name }),
        this.t('platform.assignmentAssignedBody', { assignment: info.name, course: courseName }),
        courseId,
      );
    }
  }

  private async handleAssignmentSubmitted(payload: Record<string, unknown>): Promise<void> {
    const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (!assignmentId || !courseId || !userId) return;
    const info = await this.getAssignmentNotifyInfo(assignmentId);
    if (!info) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const contextUrl = `/courses/${courseId}/assignments/${assignmentId}`;
    await this.notifyGrouped(
      userId,
      'assignment_submitted',
      contextUrl,
      this.t('platform.assignmentSubmitReceiptSubject', { assignment: info.name }),
      this.t('platform.assignmentSubmitReceiptBody', { assignment: info.name, course: courseName }),
      courseId,
    );
    const awaiting = await this.countAssignmentSubmissionsAwaitingGrading(assignmentId);
    const staffIds = await this.listCourseStaffUserIds(courseId);
    for (const staffId of staffIds) {
      if (staffId === userId) continue;
      await this.notifyGrouped(
        staffId,
        'assignment_submitted',
        contextUrl,
        this.t('platform.assignmentSubmittedSubject', { assignment: info.name }),
        this.t('platform.assignmentSubmittedBody', { assignment: info.name, course: courseName, count: awaiting }),
        courseId,
      );
    }
  }

  private async handleAssignmentReturned(payload: Record<string, unknown>): Promise<void> {
    const assignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (!assignmentId || !courseId || !userId) return;
    const info = await this.getAssignmentNotifyInfo(assignmentId);
    if (!info) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    await this.notifyGrouped(
      userId,
      'assignment_returned',
      `/courses/${courseId}/assignments/${assignmentId}`,
      this.t('platform.assignmentReturnedSubject', { assignment: info.name }),
      this.t('platform.assignmentReturnedBody', { assignment: info.name, course: courseName }),
      courseId,
    );
  }

  private async handlePinCreated(payload: Record<string, unknown>): Promise<void> {
    const pinId = typeof payload.pinId === 'string' ? payload.pinId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const actorId = typeof payload.actorId === 'string' ? payload.actorId : null;
    if (!pinId || !courseId) return;
    const info = await this.getPinNotifyInfo(pinId);
    if (!info || !this.isVisibleToStudents(info)) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const contextUrl = `/courses/${courseId}/exams/${pinId}`;
    const studentIds = await this.listActiveEnrolledUserIds(courseId);
    for (const studentId of studentIds) {
      if (studentId === actorId) continue;
      await this.notifyGrouped(
        studentId,
        'quiz_available',
        contextUrl,
        this.t('platform.quizAvailableSubject', { quiz: info.name }),
        this.t('platform.quizAvailableBody', { quiz: info.name, course: courseName }),
        courseId,
      );
    }
  }

  private async handleQuizAttemptFinished(payload: Record<string, unknown>): Promise<void> {
    const pinId = typeof payload.pinId === 'string' ? payload.pinId : null;
    const courseId = typeof payload.courseId === 'string' ? payload.courseId : null;
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (!pinId || !courseId) return;
    if (payload.needsGrading !== true || payload.preview === true) return;
    const info = await this.getPinNotifyInfo(pinId);
    if (!info) return;
    const courseName = (await this.getCourseFullName(courseId)) ?? '';
    const contextUrl = `/courses/${courseId}/exams/${pinId}/results`;
    const awaiting = await this.countPinAttemptsNeedingGrading(pinId);
    const staffIds = await this.listCourseStaffUserIds(courseId);
    for (const staffId of staffIds) {
      if (staffId === userId) continue;
      await this.notifyGrouped(
        staffId,
        'quiz_attempt_finished',
        contextUrl,
        this.t('platform.quizAttemptFinishedSubject', { quiz: info.name }),
        this.t('platform.quizAttemptFinishedBody', { quiz: info.name, course: courseName, count: awaiting }),
        courseId,
      );
    }
  }

  private async handleMessageSent(payload: Record<string, unknown>): Promise<void> {
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (!messageId) return;
    const messageRow = await this.getMessage(messageId);
    if (!messageRow || messageRow.deletedAt) return;
    const senderName = await this.getUserDisplayName(messageRow.userIdFrom);
    const contextUrl = `/messages?conversation=${messageRow.conversationId}`;
    const payloadTenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
    const conversationTenantId = payloadTenantId ?? await this.getConversationTenantId(messageRow.conversationId);
    const memberIds = await this.listMembers(messageRow.conversationId);
    const mutedMemberIds = new Set(await this.listMutedMemberIds(messageRow.conversationId));
    for (const memberId of memberIds) {
      if (memberId === messageRow.userIdFrom) continue;
      if (mutedMemberIds.has(memberId)) continue;
      if (await this.isBlocked(memberId, messageRow.userIdFrom)) continue;
      if (await this.hasUnreadNotification(memberId, 'message_new', contextUrl)) continue;
      await this.delivery.notify(memberId, 'message_new', {
        subject: this.t('platform.messageNewSubject', { name: senderName }),
        body: this.t('platform.messageNewBody'),
        contextUrl,
        fromUserId: messageRow.userIdFrom,
        tenantId: conversationTenantId ?? await this.getUserDefaultTenantId(memberId),
      });
    }
  }

  private async resolveCourseTenantId(
    payload: Record<string, unknown>,
    courseId: string,
    userId: string,
  ): Promise<string | null> {
    if (typeof payload.tenantId === 'string') return payload.tenantId;
    return (await this.getCourseTenantId(courseId)) ?? await this.getUserDefaultTenantId(userId);
  }

  private async getGradeItemNotifyInfo(itemId: string): Promise<{
    itemType: string;
    itemName: string;
    hidden: boolean;
    courseId: string;
  } | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('grade_items')
      .select(['item_type as itemType', 'item_name as itemName', 'hidden', 'course_id as courseId'])
      .where('id', '=', itemId)
      .executeTakeFirst();
    return row;
  }

  private async isGradeHiddenForUser(itemId: string, userId: string): Promise<boolean> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('grade_grades')
      .select('hidden')
      .where('item_id', '=', itemId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.hidden ?? false;
  }

  private async getCourseFullName(courseId: string): Promise<string | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('course')
      .select('full_name as fullName')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.fullName;
  }

  private async getAssignmentNotifyInfo(assignmentId: string): Promise<{
    name: string;
    courseId: string;
    courseVisible: boolean;
    cmVisible: boolean | null;
    cmDeletionInProgress: boolean | null;
  } | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('assignments')
      .innerJoin('course', 'course.id', 'assignments.course')
      .leftJoin('course_modules', 'course_modules.id', 'assignments.cm_id')
      .select([
        'assignments.name', 'assignments.course as courseId', 'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('assignments.id', '=', assignmentId)
      .executeTakeFirst();
    return row;
  }

  private async getPinNotifyInfo(pinId: string): Promise<{
    name: string;
    courseId: string;
    courseVisible: boolean;
    cmVisible: boolean | null;
    cmDeletionInProgress: boolean | null;
  } | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('exam_pins')
      .innerJoin('exam_versions', 'exam_versions.id', 'exam_pins.exam_version_id')
      .innerJoin('course', 'course.id', 'exam_pins.course_id')
      .leftJoin('course_modules', 'course_modules.id', 'exam_pins.cm_id')
      .select([
        sql<string>`coalesce(${sql.ref('exam_pins.name')}, ${sql.ref('exam_versions.name')})`.as('name'),
        'exam_pins.course_id as courseId', 'course.visible as courseVisible',
        'course_modules.visible as cmVisible',
        'course_modules.deletion_in_progress as cmDeletionInProgress',
      ])
      .where('exam_pins.id', '=', pinId)
      .executeTakeFirst();
    return row;
  }

  private async countAssignmentSubmissionsAwaitingGrading(assignmentId: string): Promise<number> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('assign_submissions')
      .leftJoin('assign_grades', (join) => join
        .onRef('assign_grades.assignment_id', '=', 'assign_submissions.assignment_id')
        .onRef('assign_grades.user_id', '=', 'assign_submissions.user_id')
        .onRef('assign_grades.attempt_number', '=', 'assign_submissions.attempt_number'))
      .select('assign_submissions.id')
      .where('assign_submissions.assignment_id', '=', assignmentId)
      .where('assign_submissions.status', '=', 'submitted')
      .where((eb) => eb.or([
        eb('assign_grades.id', 'is', null),
        eb('assign_grades.status', '!=', 'released'),
      ]))
      .execute();
    return rows.length;
  }

  private async countPinAttemptsNeedingGrading(pinId: string): Promise<number> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('exam_attempts')
      .select('id')
      .where('pin_id', '=', pinId)
      .where('state', '=', 'needsgrading')
      .where('preview', '=', false)
      .execute();
    return rows.length;
  }

  private async getUnreadNotification(userIdTo: string, eventType: string, contextUrl: string) {
    const row = await this.spaceDb.routedKysely
      .selectFrom('notifications')
      .select(['id', 'subject', 'full_message as fullMessage'])
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row;
  }

  private async updateNotificationContent(id: string, subject: string, fullMessage: string): Promise<void> {
    await this.spaceDb.routedKysely
      .updateTable('notifications')
      .set({ subject, full_message: fullMessage, small_message: fullMessage.slice(0, 200) })
      .where('id', '=', id)
      .execute();
  }

  private async hasUnreadNotification(userIdTo: string, eventType: string, contextUrl: string): Promise<boolean> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('notifications')
      .select('id')
      .where('user_id_to', '=', userIdTo)
      .where('event_type', '=', eventType)
      .where('context_url', '=', contextUrl)
      .where('time_read', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  private async getMessage(id: string) {
    const row = await this.spaceDb.routedKysely
      .selectFrom('message')
      .select(['deleted_at as deletedAt', 'user_id_from as userIdFrom', 'conversation_id as conversationId'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row;
  }

  private async getUserDisplayName(userId: string): Promise<string> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('users')
      .select(['first_name as firstName', 'last_name as lastName', 'username'])
      .where('id', '=', userId)
      .executeTakeFirst();
    return row ? displayNameOf(row) : '';
  }

  private async listMembers(conversationId: string): Promise<string[]> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('message_conversation_members')
      .select('user_id as userId')
      .where('conversation_id', '=', conversationId)
      .execute();
    return rows.map((row) => row.userId);
  }

  private async listMutedMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('message_conversation_members')
      .select('user_id as userId')
      .where('conversation_id', '=', conversationId)
      .where('muted', '=', true)
      .execute();
    return rows.map((row) => row.userId);
  }

  private async isBlocked(userId: string, blockedUserId: string): Promise<boolean> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('message_users_blocked')
      .select('user_id as userId')
      .where('user_id', '=', userId)
      .where('blocked_user_id', '=', blockedUserId)
      .execute();
    return rows.length > 0;
  }

  private async getCourseTenantId(courseId: string): Promise<string | null> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('course')
      .select('tenant_id as tenantId')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  }

  private async getConversationTenantId(conversationId: string): Promise<string | null> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('message_conversations')
      .select('tenant_id as tenantId')
      .where('id', '=', conversationId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  }

  private async getUserDefaultTenantId(userId: string): Promise<string | null> {
    const rows = await this.spaceDb.routedKysely
      .selectFrom('tenant_memberships')
      .innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id')
      .select(['tenant_memberships.tenant_id as tenantId', 'tenants.kind'])
      .where('tenant_memberships.user_id', '=', userId)
      .where('tenant_memberships.status', '=', 'active')
      .where('tenants.status', '=', 'active')
      .execute();
    const distinct = [...new Map(rows.map((row) => [row.tenantId, row])).values()];
    if (distinct.length === 1) return distinct[0]!.tenantId;
    if (distinct.length > 1) {
      const nonPlatform = distinct.find((row) => row.kind !== 'platform');
      if (nonPlatform) return nonPlatform.tenantId;
    }
    const platform = await this.spaceDb.routedKysely
      .selectFrom('tenants')
      .select('id')
      .where('kind', '=', 'platform')
      .executeTakeFirst();
    return platform?.id ?? null;
  }

  private async listActiveEnrolledUserIds(courseId: string): Promise<string[]> {
    const now = new Date();
    const rows = await this.spaceDb.routedKysely
      .selectFrom('user_enrolments')
      .innerJoin('enrol', 'enrol.id', 'user_enrolments.enrol_id')
      .select('user_enrolments.user_id as userId')
      .where('enrol.course_id', '=', courseId)
      .where('user_enrolments.status', '=', 0)
      .where('enrol.status', '=', 0)
      .where('user_enrolments.time_start', '<=', now)
      .where((eb) => eb.or([
        eb('user_enrolments.time_end', 'is', null),
        eb('user_enrolments.time_end', '>=', now),
      ]))
      .execute();
    return [...new Set(rows.map((row) => row.userId))];
  }

  private async listCourseStaffUserIds(courseId: string): Promise<string[]> {
    const courseContext = await this.spaceDb.routedKysely
      .selectFrom('context')
      .select('path')
      .where('context_level', '=', 50)
      .where('instance_id', '=', courseId)
      .executeTakeFirst();
    if (!courseContext) return [];
    const pathIds = courseContext.path.split('/').filter((part) => part.length > 0);
    if (!pathIds.length) return [];
    const rows = await this.spaceDb.routedKysely
      .selectFrom('role_assignments')
      .innerJoin('role', 'role.id', 'role_assignments.role_id')
      .select('role_assignments.user_id as userId')
      .distinct()
      .where('role.archetype', 'in', [...STAFF_ARCHETYPES])
      .where('role_assignments.context_id', 'in', pathIds)
      .execute();
    return rows.map((row) => row.userId);
  }

  private t(key: string, args?: Record<string, unknown>): string {
    return String(this.i18n.t(key, { locale: 'vi', args }));
  }
}
