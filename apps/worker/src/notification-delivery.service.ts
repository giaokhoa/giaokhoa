import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { I18nService } from '@nestjs/i18n';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { redisConnectionFromUrl } from './config/env';
import { sql, type CentreDB } from '@giaokhoa/db';
import { SpaceDatabaseService } from './db/routing/space-database.service';
import { tenantAls } from './db/tenant-als';

export const NOTIFICATION_UNREAD_CHANGED_CHANNEL = 'giaokhoa:notifications:unread-changed';

export interface WorkerProviderLaw {
  name: string;
  component: string;
  mandatoryInApp: boolean;
}

export const WORKER_PROVIDERS: Record<string, WorkerProviderLaw> = {
  calendar_reminder: { name: 'calendar_reminder', component: 'core_calendar', mandatoryInApp: false },
  report_scheduled: { name: 'report_scheduled', component: 'core_reportbuilder', mandatoryInApp: false },
  badge_awarded: { name: 'badge_awarded', component: 'core_badges', mandatoryInApp: false },
  guardian_digest: { name: 'guardian_digest', component: 'core_guardian', mandatoryInApp: false },
  guardian_overdue_alert: { name: 'guardian_overdue_alert', component: 'core_guardian', mandatoryInApp: false },
  grade_updated: { name: 'grade_updated', component: 'core_grades', mandatoryInApp: false },
  course_completed: { name: 'course_completed', component: 'core_completion', mandatoryInApp: false },
  enrol_expiry_warning: { name: 'enrol_expiry_warning', component: 'core_enrol', mandatoryInApp: true },
  activity_due_soon: { name: 'activity_due_soon', component: 'core_course', mandatoryInApp: false },
  assignment_assigned: { name: 'assignment_assigned', component: 'mod_assign', mandatoryInApp: false },
  assignment_submitted: { name: 'assignment_submitted', component: 'mod_assign', mandatoryInApp: false },
  assignment_returned: { name: 'assignment_returned', component: 'mod_assign', mandatoryInApp: false },
  quiz_available: { name: 'quiz_available', component: 'mod_quiz', mandatoryInApp: false },
  quiz_attempt_finished: { name: 'quiz_attempt_finished', component: 'mod_quiz', mandatoryInApp: false },
  message_new: { name: 'message_new', component: 'core_message', mandatoryInApp: false },
};

export type WorkerEmailFrequency = 'immediate' | 'daily' | 'off';

export interface WorkerNotifyProviderLaw {
  defaultEmailFrequency: Exclude<WorkerEmailFrequency, 'off'>;
  labelVi: string;
  externalPolicy: 'original-ok' | 'minimized';
}

export const WORKER_NOTIFY_PROVIDERS: Record<string, WorkerNotifyProviderLaw> = {
  guardian_digest: { defaultEmailFrequency: 'daily', labelVi: 'Tổng hợp cho phụ huynh', externalPolicy: 'minimized' },
  guardian_overdue_alert: { defaultEmailFrequency: 'daily', labelVi: 'Cảnh báo quá hạn cho phụ huynh', externalPolicy: 'minimized' },
  grade_updated: { defaultEmailFrequency: 'daily', labelVi: 'Điểm số thay đổi', externalPolicy: 'original-ok' },
  enrol_expiry_warning: { defaultEmailFrequency: 'daily', labelVi: 'Sắp hết hạn ghi danh', externalPolicy: 'original-ok' },
  activity_due_soon: { defaultEmailFrequency: 'daily', labelVi: 'Hoạt động sắp đến hạn', externalPolicy: 'original-ok' },
  assignment_assigned: { defaultEmailFrequency: 'daily', labelVi: 'Bài tập mới', externalPolicy: 'original-ok' },
  assignment_submitted: { defaultEmailFrequency: 'daily', labelVi: 'Bài nộp', externalPolicy: 'original-ok' },
  assignment_returned: { defaultEmailFrequency: 'daily', labelVi: 'Bài đã được trả', externalPolicy: 'original-ok' },
  quiz_available: { defaultEmailFrequency: 'daily', labelVi: 'Bài kiểm tra mới', externalPolicy: 'original-ok' },
  quiz_attempt_finished: { defaultEmailFrequency: 'daily', labelVi: 'Lượt làm bài cần chấm', externalPolicy: 'original-ok' },
  message_new: { defaultEmailFrequency: 'immediate', labelVi: 'Tin nhắn mới', externalPolicy: 'original-ok' },
};

const COURSE_MUTE_EXEMPT_PROVIDERS = new Set(['grade_updated', 'enrol_expiry_warning']);

function isExemptFromCourseMute(provider: WorkerProviderLaw): boolean {
  return provider.mandatoryInApp === true || COURSE_MUTE_EXEMPT_PROVIDERS.has(provider.name);
}

export type InAppDeliveryStatus = 'delivered' | 'skipped-suspended' | 'skipped-preference' | 'skipped-admin-disabled' | 'skipped-course-mute' | 'unknown-provider';
export interface InAppDeliveryResult { status: InAppDeliveryStatus; notificationId?: string }

@Injectable()
export class NotificationDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private publisher: Redis | null = null;

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Optional() @InjectQueue('notification-dispatch') private readonly dispatchQueue?: Queue,
    @Optional() private readonly i18n?: I18nService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.publisher) {
      await this.publisher.quit().catch(() => undefined);
      this.publisher = null;
    }
  }

  private publisherClient(): Redis {
    if (!this.publisher) {
      this.publisher = new Redis({
        ...redisConnectionFromUrl(this.config.getOrThrow<string>('REDIS_URL')),
      });
      this.publisher.on('error', (err: Error) => {
        this.logger.warn(`Redis publisher của tín hiệu thông báo lỗi: ${err.message}`);
      });
    }
    return this.publisher;
  }

  async signalUnreadCountChanged(userId: string): Promise<void> {
    try {
      await this.publisherClient().publish(NOTIFICATION_UNREAD_CHANGED_CHANNEL, JSON.stringify({
        userId,
        spaceId: tenantAls.getStore()?.spaceId ?? null,
      }));
    } catch {
    }
  }

  private async isProviderEnabledBySitePolicy(provider: WorkerProviderLaw): Promise<boolean> {
    if (provider.mandatoryInApp) return true;
    const row = await this.spaceDb.routedKysely
      .selectFrom('plugin_config')
      .select('value')
      .where('plugin', '=', 'notifications')
      .where('name', '=', `provider_${provider.name}_enabled`)
      .where('tenant_id', 'is', null)
      .executeTakeFirst();
    if (!row || row.value === null) return true;
    try {
      return JSON.parse(row.value) !== false;
    } catch {
      return true;
    }
  }

  private async getPreference(userId: string, name: string): Promise<string | undefined> {
    const row = await this.spaceDb.routedKysely
      .selectFrom('user_preferences')
      .select('value')
      .where('user_id', '=', userId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row?.value ?? undefined;
  }

  async resolvePopupEnabled(userId: string, provider: WorkerProviderLaw): Promise<boolean> {
    let enabled: boolean;
    const v2 = await this.getPreference(userId, `message_provider_${provider.name}_popup_v2`);
    if (v2 !== undefined) {
      enabled = v2 !== '0';
    } else {
      let legacy: boolean | undefined;
      for (const state of ['loggedin', 'loggedoff'] as const) {
        const value = await this.getPreference(userId, `message_provider_${provider.name}_popup_${state}`);
        if (value !== undefined) { legacy = value !== '0'; break; }
      }
      enabled = legacy ?? true;
    }
    if (provider.mandatoryInApp) enabled = true;
    return enabled;
  }

  async deliverInApp(userId: string, providerName: string, input: {
    subject: string; body: string; smallMessage: string; contextUrl?: string | null; fromUserId?: string | null;
    tenantId?: string | null;
    courseId?: string | null;
  }): Promise<InAppDeliveryResult> {
    const provider = WORKER_PROVIDERS[providerName];
    if (!provider) return { status: 'unknown-provider' };

    const user = await this.spaceDb.routedKysely
      .selectFrom('users')
      .select(['id', 'suspended', 'deleted'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.suspended || user.deleted) {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider: providerName, channel: 'popup', status: 'skipped-suspended',
        subject: input.subject, dedupe_key: `skipped-suspended-${providerName}-${userId}-${randomUUID()}`,
        tenant_id: input.tenantId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-suspended' };
    }

    if (!(await this.isProviderEnabledBySitePolicy(provider))) {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider: providerName, channel: 'popup', status: 'skipped-admin-disabled',
        subject: input.subject, dedupe_key: `admin-disabled-${providerName}-${userId}-${randomUUID()}`,
        tenant_id: null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-admin-disabled' };
    }

    if (input.courseId && !isExemptFromCourseMute(provider)
      && (await this.getPreference(userId, `notif.course.${input.courseId}`)) === 'mute') {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider: providerName, channel: 'popup', status: 'skipped-course-mute',
        subject: input.subject, dedupe_key: `course-mute-${providerName}-${userId}-${randomUUID()}`,
        tenant_id: input.tenantId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-course-mute' };
    }

    if (!(await this.resolvePopupEnabled(userId, provider))) {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider: providerName, channel: 'popup', status: 'skipped-preference',
        subject: input.subject, dedupe_key: `popup-off-${providerName}-${userId}-${randomUUID()}`,
        tenant_id: input.tenantId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-preference' };
    }

    const notification = await this.spaceDb.routedKysely.insertInto('notifications').values({
      user_id_from: input.fromUserId ?? null, user_id_to: userId,
      subject: input.subject, full_message: input.body, small_message: input.smallMessage,
      component: provider.component, event_type: providerName,
      context_url: input.contextUrl ?? null,
      tenant_id: input.tenantId ?? null,
    }).returning('id').executeTakeFirst();
    await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
      notification_id: notification!.id, user_id: userId, provider: providerName,
      channel: 'popup', status: 'delivered', subject: input.subject,
      dedupe_key: `popup-${notification!.id}`,
      tenant_id: input.tenantId ?? null,
    }).onConflict((oc) => oc.doNothing()).execute();
    await this.signalUnreadCountChanged(userId);
    return { status: 'delivered', notificationId: notification!.id };
  }

  private async resolveEmailFrequency(userId: string, providerName: string, defaultFrequency: Exclude<WorkerEmailFrequency, 'off'>): Promise<WorkerEmailFrequency> {
    const v2 = await this.getPreference(userId, `message_provider_${providerName}_email_v2`);
    if (v2 === 'immediate' || v2 === 'daily' || v2 === 'off') return v2;
    let legacy: boolean | undefined;
    for (const state of ['loggedin', 'loggedoff'] as const) {
      const value = await this.getPreference(userId, `message_provider_${providerName}_email_${state}`);
      if (value !== undefined) { legacy = value !== '0'; break; }
    }
    if (legacy === undefined) return defaultFrequency;
    return legacy ? defaultFrequency : 'off';
  }

  private resolveExternalContent(providerName: string, law: WorkerNotifyProviderLaw, input: { subject: string; body: string; externalSubject?: string; externalBody?: string }): { subject: string; body: string } {
    if (law.externalPolicy === 'original-ok') {
      return { subject: input.externalSubject ?? input.subject, body: input.externalBody ?? input.body };
    }
    if (input.externalSubject !== undefined && input.externalBody !== undefined) {
      return { subject: input.externalSubject, body: input.externalBody };
    }
    if (process.env.NODE_ENV === 'test') {
      throw new Error(
        `messaging.external_minimization_required: nhà cung cấp ${providerName} thiếu nội dung ngoài đã tối thiểu hoá (externalSubject/externalBody)`,
      );
    }
    this.logger.warn(`Thông báo ${providerName} thiếu nội dung ngoài đã tối thiểu hoá; dùng nội dung chung cho kênh ngoài`);
    return {
      subject: input.externalSubject ?? this.i18n!.t('platform.externalGenericSubject', { locale: 'vi' }),
      body: input.externalBody ?? this.i18n!.t('platform.externalGenericBody', { locale: 'vi', args: { event: law.labelVi } }),
    };
  }

  async notify(userId: string, providerName: string, input: {
    subject: string; body: string; contextUrl?: string; fromUserId?: string;
    externalSubject?: string; externalBody?: string; tenantId?: string | null;
    courseId?: string | null; eventId?: string;
  }): Promise<{ notificationId: string | null; channels: Record<string, string>; skipped?: string }> {
    const provider = WORKER_PROVIDERS[providerName];
    if (!provider) return { notificationId: null, channels: {}, skipped: 'unknown-provider' };
    const tenantId = input.tenantId ?? null;
    const tenantKey = tenantId ?? 'platform';

    const popup = await this.deliverInApp(userId, providerName, {
      subject: input.subject, body: input.body, smallMessage: input.body.slice(0, 200),
      contextUrl: input.contextUrl, fromUserId: input.fromUserId, tenantId,
      courseId: input.courseId,
    });
    if (popup.status === 'skipped-suspended') return { notificationId: null, channels: {}, skipped: 'suspended' };
    if (popup.status === 'skipped-admin-disabled') return { notificationId: null, channels: {}, skipped: 'admin-disabled' };
    if (popup.status === 'skipped-course-mute') return { notificationId: null, channels: {}, skipped: 'course-mute' };

    const channels: Record<string, string> = {};
    const notificationId = popup.notificationId ?? null;
    if (popup.status === 'delivered') channels['popup'] = 'delivered';
    if (popup.status === 'skipped-preference') channels['popup'] = 'skipped-preference';

    const emailLaw = WORKER_NOTIFY_PROVIDERS[providerName];
    if (emailLaw) {
      if (!this.dispatchQueue || !this.i18n) {
        throw new Error('NotificationDeliveryService.notify cần hàng đợi notification-dispatch và I18nService — chỉ dùng qua WorkerModule');
      }
      const frequency = await this.resolveEmailFrequency(userId, providerName, emailLaw.defaultEmailFrequency);
      if (frequency === 'off') {
        await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
          user_id: userId, provider: providerName, channel: 'email', status: 'skipped-preference', subject: input.subject,
          dedupe_key: `${tenantKey}-email-off-${providerName}-${userId}-${randomUUID()}`,
          tenant_id: tenantId,
        }).onConflict((oc) => oc.doNothing()).execute();
        channels['email'] = 'skipped-preference';
      } else {
        const external = this.resolveExternalContent(providerName, emailLaw, input);
        const inAppContentHash = createHash('sha256').update(JSON.stringify([input.subject, input.body, input.fromUserId ?? null, input.contextUrl ?? null, input.courseId ?? null])).digest('hex');
        const eventKey = notificationId ?? (input.eventId ? `event-${input.eventId}` : `content-${inAppContentHash}`);
        const dedupeKey = `${tenantKey}-dispatch-${providerName}-${userId}-email-${eventKey}`;
        await this.dispatchQueue.add('dispatch', {
          userId, provider: providerName, channel: 'email', tenantId,
          emailFrequency: frequency, subject: external.subject, body: external.body,
          notificationId, dedupeKey,
        }, { jobId: dedupeKey, attempts: 3 });
        channels['email'] = 'queued';
      }
    }

    await this.spaceDb.routedKysely.insertInto('outbox_events').values({
      aggregate: 'messaging', type: 'notification_created', tenant_id: tenantId,
      payload: sql<CentreDB['outbox_events']['payload']>`${JSON.stringify({ userId, provider: providerName, notificationId, ...(tenantId ? { tenantId } : {}) })}::jsonb`,
    }).execute();
    return { notificationId, channels };
  }
}
