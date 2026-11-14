import { backgroundJobContext, backgroundJobId } from '../../db/routing/background-job-context';
import { BadRequestException, ForbiddenException, Logger, NotFoundException, type MessageEvent } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import type { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import type { NotificationGroup, NotificationGroupPage, NotificationItem, NotificationItemPage } from '@giaokhoa/contracts';
import type { ListNotificationGroupsQueryDto, ListNotificationItemsQueryDto, ReadNotificationGroupDto } from './dto/messaging.dto';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { SiteConfigService } from '../site-config/site-config.service';
import { UsersService } from '../users/users.service';
import { MessagingRepository, type NotificationRow } from '@giaokhoa/db/repositories/messaging';
import { NotificationUnreadStreamService } from './notification-unread-stream.service';
import { tenantAls } from '../tenants/tenant-als';
import { MessagingGroupTreeService } from './messaging-group-tree.service';
import {
  MESSAGE_PROVIDERS,
  providerByName,
  externalPolicyOf,
  providerVisibleToAudiences,
  isTeacherOnlyProvider,
  eventTypesOfGroup,
  groupOfEventType,
  preferenceName,
  preferenceNameV2,
  coursePreferenceName,
  isExemptFromCourseMute,
  EMAIL_CHANNEL_AVAILABLE,
  defaultEmailFrequency,
  NOTIFICATION_POLICY_COMPONENT,
  notificationPolicySettingName,
  type MessageChannel,
  type LoginState,
  type EmailFrequency,
  type ExternalContentPolicy,
  type MessageProviderDefinition,
  type NotificationAudience,
  type NotificationPreferenceView,
  type NotifyResult,
  type NotificationCourseOverrideMode,
  type NotificationCourseOverrideView,
} from './notification-providers';

export const NOTIFICATION_DISPATCH_QUEUE = 'notification-dispatch';

const NOTIFICATION_PAGE_DEFAULT_LIMIT = 20;

function encodeNotificationCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), id }), 'utf8').toString('base64url');
}

function decodeNotificationCursor(raw: string): { at: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.id !== 'string') throw new Error('bad cursor');
    const at = new Date(parsed.t);
    if (Number.isNaN(at.getTime())) throw new Error('bad cursor');
    return { at, id: parsed.id };
  } catch {
    throw new BadRequestException({ message: 'Invalid notification cursor', code: 'messaging.invalid_cursor' });
  }
}

function notificationItemView(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    userIdFrom: row.userIdFrom,
    userIdTo: row.userIdTo,
    subject: row.subject,
    fullMessage: row.fullMessage,
    smallMessage: row.smallMessage,
    component: row.component,
    eventType: row.eventType,
    contextUrl: row.contextUrl,
    contextUrlName: row.contextUrlName,
    timeRead: row.timeRead ? row.timeRead.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface NotificationChannelPort {
  channel: MessageChannel;
  deliver(input: { userId: string; provider: string; subject: string; body: string; notificationId: string | null }): Promise<string>;
}

export class MessagingNotificationsService {
  private readonly logger = new Logger(MessagingNotificationsService.name);

  private tenantScope(): string | undefined {
    return tenantAls.getStore()?.tenantId;
  }

  constructor(
    private readonly repo: MessagingRepository,
    private readonly users: UsersService,
    private readonly evaluator: PermissionEvaluator,
    private readonly outbox: OutboxService,
    private readonly unreadStream: NotificationUnreadStreamService,
    private readonly dispatchQueue: Queue,
    private readonly siteConfig: SiteConfigService,
    private readonly groupTree: MessagingGroupTreeService,
    private readonly i18n: I18nService,
  ) {}


  async isProviderEnabledBySitePolicy(provider: MessageProviderDefinition): Promise<boolean> {
    if (provider.mandatoryInApp) return true;
    const value = await this.siteConfig.getValue<boolean>(
      NOTIFICATION_POLICY_COMPONENT,
      notificationPolicySettingName(provider.name),
    );
    return value !== false;
  }

  async hasFullNotificationPreferences(userId: string): Promise<boolean> {
    if (await this.evaluator.isSiteAdmin(userId)) return true;
    return this.repo.hasStaffRoleAssignment(userId);
  }

  async resolvePreferenceAudiences(userId: string): Promise<Set<NotificationAudience>> {
    if (await this.evaluator.isSiteAdmin(userId)) {
      return new Set<NotificationAudience>(['student', 'staff', 'guardian', 'admin', 'all']);
    }
    const audiences = new Set<NotificationAudience>();
    if (await this.repo.hasStaffRoleAssignment(userId)) audiences.add('staff');
    if (await this.repo.hasStudentContext(userId)) audiences.add('student');
    if (await this.repo.hasActiveGuardianLink(userId)) audiences.add('guardian');
    return audiences;
  }

  async isChannelEnabled(userId: string, provider: string, channel: MessageChannel, state: LoginState): Promise<boolean> {
    const value = await this.users.getPreference(userId, preferenceName(provider, channel, state));
    return value !== '0';
  }

  private async legacyChannelValue(userId: string, provider: string, channel: MessageChannel): Promise<boolean | undefined> {
    for (const state of ['loggedin', 'loggedoff'] as LoginState[]) {
      const value = await this.users.getPreference(userId, preferenceName(provider, channel, state));
      if (value !== undefined && value !== null) return value !== '0';
    }
    return undefined;
  }

  async resolveNotificationPreference(userId: string, provider: MessageProviderDefinition): Promise<{ popupEnabled: boolean; emailFrequency: EmailFrequency | null }> {
    let popupEnabled: boolean;
    const popupV2 = await this.users.getPreference(userId, preferenceNameV2(provider.name, 'popup'));
    if (popupV2 !== undefined && popupV2 !== null) popupEnabled = popupV2 !== '0';
    else popupEnabled = (await this.legacyChannelValue(userId, provider.name, 'popup')) ?? true;
    if (provider.mandatoryInApp) popupEnabled = true;

    let emailFrequency: EmailFrequency | null = null;
    if (provider.channels.includes('email')) {
      const emailV2 = await this.users.getPreference(userId, preferenceNameV2(provider.name, 'email'));
      if (emailV2 === 'immediate' || emailV2 === 'daily' || emailV2 === 'off') emailFrequency = emailV2;
      else {
        const legacy = await this.legacyChannelValue(userId, provider.name, 'email');
        emailFrequency = legacy === undefined ? defaultEmailFrequency(provider.group) : legacy ? defaultEmailFrequency(provider.group) : 'off';
      }
    }
    return { popupEnabled, emailFrequency };
  }

  private async preferenceView(userId: string, provider: MessageProviderDefinition): Promise<NotificationPreferenceView> {
    const resolved = await this.resolveNotificationPreference(userId, provider);
    return {
      provider: provider.name, component: provider.component, group: provider.group,
      label: provider.label, description: provider.description,
      teacherOnly: isTeacherOnlyProvider(provider), mandatoryInApp: provider.mandatoryInApp ?? false,
      popupEnabled: resolved.popupEnabled, emailFrequency: resolved.emailFrequency,
      emailAvailable: EMAIL_CHANNEL_AVAILABLE,
      siteEnabled: await this.isProviderEnabledBySitePolicy(provider),
    };
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceView[]> {
    if (!(await this.hasFullNotificationPreferences(userId))) return [];
    const audiences = await this.resolvePreferenceAudiences(userId);
    const out: NotificationPreferenceView[] = [];
    for (const provider of MESSAGE_PROVIDERS) {
      if (providerVisibleToAudiences(provider, audiences)) out.push(await this.preferenceView(userId, provider));
    }
    return out;
  }

  async setPreference(userId: string, input: { provider: string; popupEnabled?: boolean; emailFrequency?: EmailFrequency }): Promise<NotificationPreferenceView> {
    if (!(await this.hasFullNotificationPreferences(userId))) {
      throw new ForbiddenException({
        message: 'Per-type notification preferences are only available to teaching and administrative staff',
        code: 'messaging.preference_staff_only',
      });
    }
    const provider = providerByName(input.provider);
    if (!provider) throw new BadRequestException({ message: `Unknown message provider ${input.provider}`, code: 'messaging.unknown_provider' });
    if (!providerVisibleToAudiences(provider, await this.resolvePreferenceAudiences(userId))) {
      throw new ForbiddenException({
        message: `Notification type ${input.provider} is not available for your roles`,
        code: 'messaging.preference_audience',
      });
    }
    if (input.popupEnabled === undefined && input.emailFrequency === undefined) {
      throw new BadRequestException({ message: 'Nothing to update: provide popupEnabled and/or emailFrequency', code: 'messaging.preference_empty' });
    }
    if (input.emailFrequency !== undefined && !provider.channels.includes('email')) {
      throw new BadRequestException({ message: `Provider ${input.provider} has no channel email`, code: 'messaging.unknown_channel' });
    }
    if (input.popupEnabled === false && provider.mandatoryInApp) {
      throw new BadRequestException({ message: `Provider ${input.provider} is mandatory in-app and cannot be turned off`, code: 'messaging.preference_mandatory' });
    }
    if (input.popupEnabled !== undefined) {
      await this.users.setPreference(userId, preferenceNameV2(input.provider, 'popup'), input.popupEnabled ? '1' : '0');
    }
    if (input.emailFrequency !== undefined) {
      await this.users.setPreference(userId, preferenceNameV2(input.provider, 'email'), input.emailFrequency);
    }
    return this.preferenceView(userId, provider);
  }

  async getCourseOverrideMode(userId: string, courseId: string): Promise<NotificationCourseOverrideMode> {
    const value = await this.users.getPreference(userId, coursePreferenceName(courseId));
    return value === 'mute' ? 'mute' : 'all';
  }

  async listCourseNotificationOverrides(userId: string): Promise<NotificationCourseOverrideView[]> {
    const courses = await this.groupTree.listMyMessagingCourses(userId);
    const out: NotificationCourseOverrideView[] = [];
    for (const course of courses) {
      out.push({
        courseId: course.courseId, courseName: course.fullName,
        mode: await this.getCourseOverrideMode(userId, course.courseId),
      });
    }
    return out;
  }

  async setCourseNotificationOverride(
    userId: string,
    input: { courseId: string; mode: NotificationCourseOverrideMode },
  ): Promise<NotificationCourseOverrideView> {
    const courses = await this.groupTree.listMyMessagingCourses(userId);
    const course = courses.find((c) => c.courseId === input.courseId);
    if (!course) {
      throw new NotFoundException({ message: 'Course not found', code: 'messaging.course_not_found' });
    }
    await this.users.setPreference(userId, coursePreferenceName(input.courseId), input.mode);
    return { courseId: course.courseId, courseName: course.fullName, mode: input.mode };
  }


  async notify(userId: string, providerName: string, input: {
    subject: string; body: string; contextUrl?: string; fromUserId?: string; loggedIn?: boolean;
    externalSubject?: string; externalBody?: string;
    forceExternalMinimized?: boolean;
    courseId?: string;
    tenantId?: string | null;
    eventId?: string;
  }): Promise<NotifyResult> {
    const provider = providerByName(providerName);
    if (!provider) return { provider: providerName, userId, notificationId: null, channels: {}, skipped: 'unknown-provider' };
    const recipient = await this.users.getByIdOrUndefined(userId);
    let tenantId = input.tenantId ?? tenantAls.getStore()?.tenantId ?? null;
    if (tenantId === null && recipient) {
      tenantId = await this.repo.getUserDefaultTenantId(userId);
    }
    const tenantKey = tenantId ?? 'platform';
    if (!recipient || recipient.suspended || recipient.deleted) {
      await this.repo.insertDispatchLog({
        userId: userId, provider: providerName, channel: 'popup', status: 'skipped-suspended', tenantId,
        subject: input.subject, dedupeKey: `${tenantKey}-skipped-suspended-${providerName}-${userId}-${randomUUID()}`,
      }).catch(() => undefined);
      return { provider: providerName, userId, notificationId: null, channels: {}, skipped: 'suspended' };
    }
    if (!(await this.isProviderEnabledBySitePolicy(provider))) {
      await this.repo.insertDispatchLog({
        userId: userId, provider: providerName, channel: 'popup', status: 'skipped-admin-disabled', tenantId,
        subject: input.subject, dedupeKey: `admin-disabled-${providerName}-${userId}-${randomUUID()}`,
      });
      return { provider: providerName, userId, notificationId: null, channels: {}, skipped: 'admin-disabled' };
    }
    if (input.courseId && !isExemptFromCourseMute(provider)
      && (await this.users.getPreference(userId, coursePreferenceName(input.courseId))) === 'mute') {
      await this.repo.insertDispatchLog({
        userId: userId, provider: providerName, channel: 'popup', status: 'skipped-course-mute', tenantId,
        subject: input.subject, dedupeKey: `course-mute-${providerName}-${userId}-${randomUUID()}`,
      });
      return { provider: providerName, userId, notificationId: null, channels: {}, skipped: 'course-mute' };
    }
    const state: LoginState = (input.loggedIn ?? true) ? 'loggedin' : 'loggedoff';
    const channels: Record<string, string> = {};
    let notificationId: string | null = null;
    const resolved = await this.resolveNotificationPreference(userId, provider);

    if (provider.channels.includes('popup')) {
      if (resolved.popupEnabled) {
        const notification = await this.repo.insertNotification({
          userIdFrom: input.fromUserId ?? null, userIdTo: userId, tenantId,
          subject: input.subject, fullMessage: input.body, smallMessage: input.body.slice(0, 200),
          component: provider.component, eventType: providerName,
          contextUrl: input.contextUrl ?? null,
        });
        notificationId = notification.id;
        channels.popup = 'delivered';
        await this.repo.insertDispatchLog({
          notificationId: notification.id, userId: userId, provider: providerName, channel: 'popup',
          status: 'delivered', subject: input.subject, tenantId,
          dedupeKey: `${tenantKey}-popup-${notification.id}`,
        });
      } else {
        channels.popup = 'skipped-preference';
        await this.repo.insertDispatchLog({
          userId: userId, provider: providerName, channel: 'popup', status: 'skipped-preference', tenantId,
          subject: input.subject, dedupeKey: `${tenantKey}-popup-off-${providerName}-${userId}-${randomUUID()}`,
        });
      }
    }

    if (notificationId) {
      await this.unreadStream.signalUnreadCountChanged(userId);
    }

    let externalContent: { subject: string; body: string } | undefined;
    for (const channel of provider.channels.filter((c) => c !== 'popup')) {
      const channelEnabled = channel === 'email'
        ? resolved.emailFrequency !== 'off'
        : await this.isChannelEnabled(userId, providerName, channel, state);
      if (channelEnabled) {
        externalContent ??= this.resolveExternalContent(provider, userId, input);
        const inAppContentHash = createHash('sha256').update(JSON.stringify([input.subject, input.body])).digest('hex');
        const eventKey = notificationId ?? (input.eventId ? `event-${input.eventId}` : `content-${inAppContentHash}`);
        const dedupeKey = `${tenantKey}-dispatch-${providerName}-${userId}-${channel}-${eventKey}`;
        await this.dispatchQueue.add('dispatch', {
          userId, provider: providerName, channel, tenantId,
          spaceSlug: backgroundJobContext().spaceSlug,
          spaceId: backgroundJobContext().spaceId,
          ...(channel === 'email' ? { emailFrequency: resolved.emailFrequency } : {}),
          subject: externalContent.subject, body: externalContent.body,
          notificationId, dedupeKey,
        }, { jobId: backgroundJobId(dedupeKey), attempts: 3 });
        channels[channel] = 'queued';
      } else {
        channels[channel] = 'skipped-preference';
        await this.repo.insertDispatchLog({
          userId: userId, provider: providerName, channel, status: 'skipped-preference', tenantId,
          subject: input.subject, dedupeKey: `${tenantKey}-${channel}-off-${providerName}-${userId}-${randomUUID()}`,
        });
      }
    }

    await this.outbox.enqueueStandalone({
      aggregate: 'messaging', type: 'notification_created', tenantId,
      payload: { userId, provider: providerName, notificationId },
    });
    return { provider: providerName, userId, notificationId, channels };
  }

  private resolveExternalContent(
    provider: MessageProviderDefinition,
    userId: string,
    input: {
      subject: string; body: string;
      externalSubject?: string; externalBody?: string;
      forceExternalMinimized?: boolean;
    },
  ): { subject: string; body: string } {
    const policy: ExternalContentPolicy = input.forceExternalMinimized
      ? 'minimized'
      : externalPolicyOf(provider);
    if (policy === 'original-ok') {
      return { subject: input.externalSubject ?? input.subject, body: input.externalBody ?? input.body };
    }
    if (input.externalSubject !== undefined && input.externalBody !== undefined) {
      return { subject: input.externalSubject, body: input.externalBody };
    }
    if (!input.forceExternalMinimized && process.env.NODE_ENV === 'test') {
      throw new Error(
        `messaging.external_minimization_required: provider "${provider.name}" is classified 'minimized' for external channels but notify() received no complete externalSubject/externalBody — pass minimized variants at the call site or declare 'original-ok' with a reason in the provider registry (C-5, issue #219)`,
      );
    }
    this.logger.warn(
      input.forceExternalMinimized
        ? `notify(): đường gửi hệ thống áp cứng tối thiểu hoá cho provider "${provider.name}" (người nhận ${userId}) — job kênh ngoài dùng bản tóm tắt mặc định (C-5, issue #219).`
        : `notify(): provider "${provider.name}" thuộc diện tối thiểu hoá kênh ngoài nhưng nơi gọi không truyền đủ bản tối thiểu hoá (người nhận ${userId}) — job kênh ngoài dùng bản tóm tắt mặc định (C-5, issue #219).`,
    );
    return {
      subject: input.externalSubject ?? String(this.i18n.t('platform.externalGenericSubject', { locale: 'vi' })),
      body: input.externalBody ?? String(this.i18n.t('platform.externalGenericBody', { locale: 'vi', args: { event: provider.label.vi } })),
    };
  }

  async sendSystemNotification(actorId: string, dto: { userId: string; provider: string; subject: string; body: string; contextUrl?: string }): Promise<NotifyResult> {
    if (!(await this.evaluator.isSiteAdmin(actorId))) {
      throw new ForbiddenException({ message: 'Only site administrators can trigger system notifications directly', code: 'messaging.system_send_forbidden' });
    }
    return this.notify(dto.userId, dto.provider, { subject: dto.subject, body: dto.body, contextUrl: dto.contextUrl, forceExternalMinimized: true });
  }

  async listNotificationGroups(userId: string, query: ListNotificationGroupsQueryDto): Promise<NotificationGroupPage> {
    const limit = query.limit ?? NOTIFICATION_PAGE_DEFAULT_LIMIT;
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : undefined;
    const aggregates = await this.repo.listNotificationGroups(userId, {
      eventTypes: query.group ? eventTypesOfGroup(query.group) : undefined,
      unreadOnly: query.unreadOnly,
      cursor: cursor ? { latestAt: cursor.at, latestId: cursor.id } : undefined,
      limit: limit + 1,
    }, this.tenantScope());
    const page = aggregates.slice(0, limit);
    const latestRows = await this.repo.listNotificationsByIds(page.map((a) => a.latestId), this.tenantScope());
    const latestById = new Map(latestRows.map((r) => [r.id, r]));
    const items: NotificationGroup[] = page.map((a) => {
      const latest = latestById.get(a.latestId);
      const latestAt = a.latestAt instanceof Date ? a.latestAt : new Date(a.latestAt);
      return {
        eventType: a.eventType,
        component: a.component,
        group: groupOfEventType(a.eventType),
        contextUrl: a.sourceKey === '' ? null : a.sourceKey,
        day: a.day,
        count: a.count,
        unreadCount: a.unreadCount,
        latest: {
          id: a.latestId,
          subject: latest?.subject ?? '',
          smallMessage: latest?.smallMessage ?? '',
          contextUrlName: latest?.contextUrlName ?? null,
          createdAt: (latest?.createdAt ?? latestAt).toISOString(),
          timeRead: latest?.timeRead ? latest.timeRead.toISOString() : null,
        },
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: aggregates.length > limit && last
        ? encodeNotificationCursor(last.latestAt instanceof Date ? last.latestAt : new Date(last.latestAt), last.latestId)
        : null,
    };
  }

  async listNotificationItems(userId: string, query: ListNotificationItemsQueryDto): Promise<NotificationItemPage> {
    const limit = query.limit ?? NOTIFICATION_PAGE_DEFAULT_LIMIT;
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : undefined;
    const rows = await this.repo.listNotificationItems(userId, {
      eventType: query.eventType,
      eventTypes: query.group ? eventTypesOfGroup(query.group) : undefined,
      source: query.contextUrl === undefined ? undefined : query.contextUrl === '' ? null : query.contextUrl,
      day: query.day,
      unreadOnly: query.unreadOnly,
      cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
      limit: limit + 1,
    }, this.tenantScope());
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(notificationItemView),
      nextCursor: rows.length > limit && last ? encodeNotificationCursor(last.createdAt, last.id) : null,
    };
  }

  async markNotificationGroupRead(userId: string, dto: ReadNotificationGroupDto): Promise<{ marked: number }> {
    const marked = await this.repo.markNotificationGroupRead(userId, {
      eventType: dto.eventType,
      sourceKey: dto.contextUrl ?? '',
      day: dto.day,
    }, this.tenantScope());
    if (marked > 0) await this.unreadStream.signalUnreadCountChanged(userId);
    return { marked };
  }

  async deleteNotification(userId: string, notificationId: string): Promise<{ deleted: boolean }> {
    const ok = await this.repo.deleteNotification(notificationId, userId, this.tenantScope());
    if (!ok) throw new NotFoundException({ message: `Notification ${notificationId} not found`, code: 'messaging.notification_not_found' });
    return { deleted: true };
  }

  async clearReadNotifications(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.repo.deleteReadNotifications(userId, this.tenantScope()) };
  }

  async unreadNotificationCount(userId: string): Promise<number> {
    return this.repo.countUnreadNotifications(userId, this.tenantScope());
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<{ read: boolean }> {
    const ok = await this.repo.markNotificationRead(notificationId, userId, this.tenantScope());
    if (!ok) throw new NotFoundException({ message: `Notification ${notificationId} not found`, code: 'messaging.notification_not_found' });
    await this.unreadStream.signalUnreadCountChanged(userId);
    return { read: true };
  }

  async markAllNotificationsRead(userId: string): Promise<{ marked: number }> {
    const marked = await this.repo.markAllNotificationsRead(userId, this.tenantScope());
    if (marked > 0) await this.unreadStream.signalUnreadCountChanged(userId);
    return { marked };
  }

  unreadCountStream(userId: string): Observable<MessageEvent> {
    return this.unreadStream.streamUnreadCount(userId);
  }

  async listDispatchLog(userId: string) {
    return this.repo.listDispatchLog(userId);
  }
}
