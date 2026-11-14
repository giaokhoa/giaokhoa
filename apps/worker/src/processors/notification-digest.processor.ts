import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { Logger } from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import type { Job } from 'bullmq';
import { ResendMailService, type WorkerMailSendResult } from '../resend-mail.service';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

const MANDATORY_PROVIDERS = new Set(['enrol_expiry_warning', 'admin_announcement']);

export interface NotificationDigestSweepResult {
  usersSent: number;
  usersDeferred: number;
  usersSkipped: number;
  usersFailed: number;
  itemsSent: number;
  itemsSuppressedAdmin: number;
  itemsSuppressedPreference: number;
}

@Processor('notification-digests')
export class NotificationDigestProcessor extends ObservedWorkerHost {
  private readonly logger = new Logger(NotificationDigestProcessor.name);

  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly mail: ResendMailService,
    private readonly i18n: I18nService,
  ) { super(); }

  async process(job: Job): Promise<NotificationDigestSweepResult> {
    void job;
    return this.spaceDb.sweepDedicatedSpaces(() => this.sweep(), (a, b) => ({
      usersSent: a.usersSent + b.usersSent,
      usersDeferred: a.usersDeferred + b.usersDeferred,
      usersSkipped: a.usersSkipped + b.usersSkipped,
      usersFailed: a.usersFailed + b.usersFailed,
      itemsSent: a.itemsSent + b.itemsSent,
      itemsSuppressedAdmin: a.itemsSuppressedAdmin + b.itemsSuppressedAdmin,
      itemsSuppressedPreference: a.itemsSuppressedPreference + b.itemsSuppressedPreference,
    }));
  }

  private async sweep(): Promise<NotificationDigestSweepResult> {
    const result: NotificationDigestSweepResult = {
      usersSent: 0, usersDeferred: 0, usersSkipped: 0, usersFailed: 0, itemsSent: 0,
      itemsSuppressedAdmin: 0, itemsSuppressedPreference: 0,
    };
    const pending = await this.spaceDb.routedKysely
      .selectFrom('notification_dispatch_log')
      .select(['id', 'user_id as userId', 'provider', 'subject'])
      .where('channel', '=', 'email')
      .where('status', '=', 'digest-queued')
      .orderBy('created_at', 'asc')
      .execute();
    if (pending.length === 0) return result;

    const byUser = new Map<string, typeof pending>();
    for (const row of pending) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    for (const [userId, rows] of byUser) {
      const ids = rows.map((r) => r.id);
      const user = await this.spaceDb.routedKysely
        .selectFrom('users')
        .select(['suspended', 'deleted', 'email'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!user || user.suspended || user.deleted) {
        await this.spaceDb.routedKysely
          .updateTable('notification_dispatch_log')
          .set({ status: 'skipped-suspended' })
          .where('id', 'in', ids)
          .where('status', '=', 'digest-queued')
          .execute();
        result.usersSkipped += 1;
        continue;
      }
      const prefs = await this.spaceDb.routedKysely
        .selectFrom('user_preferences')
        .select(['name', 'value'])
        .where('user_id', '=', userId)
        .execute();
      const prefByName = new Map(prefs.map((p) => [p.name, p.value]));
      const providersInGroup = [...new Set(rows.map((r) => r.provider))];
      const policyRows = await this.spaceDb.routedKysely
        .selectFrom('plugin_config')
        .select(['name', 'value'])
        .where('plugin', '=', 'notifications')
        .where('tenant_id', 'is', null)
        .where('name', 'in', providersInGroup.map((p) => `provider_${p}_enabled`))
        .execute();
      const adminDisabledProviders = new Set<string>();
      for (const policy of policyRows) {
        let disabled: boolean;
        try { disabled = JSON.parse(policy.value ?? 'null') === false; } catch { disabled = false; }
        if (disabled) adminDisabledProviders.add(policy.name.replace('provider_', '').replace('_enabled', ''));
      }
      const suppressedAdmin: string[] = [];
      const suppressedPreference: string[] = [];
      const sendable: typeof rows = [];
      for (const row of rows) {
        if (adminDisabledProviders.has(row.provider) && !MANDATORY_PROVIDERS.has(row.provider)) {
          suppressedAdmin.push(row.id);
          continue;
        }
        const emailOff = prefByName.get(`message_provider_${row.provider}_email_v2`) === 'off'
          || (prefByName.get(`message_provider_${row.provider}_email_loggedin`) === '0'
            && prefByName.get(`message_provider_${row.provider}_email_loggedoff`) === '0');
        if (emailOff) {
          suppressedPreference.push(row.id);
          continue;
        }
        sendable.push(row);
      }
      if (suppressedAdmin.length > 0) {
        await this.spaceDb.routedKysely
          .updateTable('notification_dispatch_log')
          .set({ status: 'skipped-admin-disabled' })
          .where('id', 'in', suppressedAdmin)
          .where('status', '=', 'digest-queued')
          .execute();
        result.itemsSuppressedAdmin += suppressedAdmin.length;
      }
      if (suppressedPreference.length > 0) {
        await this.spaceDb.routedKysely
          .updateTable('notification_dispatch_log')
          .set({ status: 'skipped-preference' })
          .where('id', 'in', suppressedPreference)
          .where('status', '=', 'digest-queued')
          .execute();
        result.itemsSuppressedPreference += suppressedPreference.length;
      }
      if (sendable.length === 0) continue;
      const count = sendable.length;
      const subject = this.i18n.t('platform.notificationDigestSubject', { locale: 'vi', args: { count } });
      const intro = this.i18n.t('platform.notificationDigestIntro', { locale: 'vi', args: { count } });
      const footer = this.i18n.t('platform.notificationDigestFooter', { locale: 'vi' });
      const text = [intro, ...sendable.map((r) => `- ${r.subject}`), footer].join('\n');
      let sendResult: WorkerMailSendResult;
      try {
        sendResult = await this.mail.send({ to: user.email, subject, text });
      } catch (err) {
        this.logger.error(
          `Tổng hợp email cho user ${userId} lỗi (${count} mục vẫn chờ): ${err instanceof Error ? err.message : String(err)}`,
        );
        result.usersFailed += 1;
        continue;
      }
      if (sendResult.status === 'skipped') {
        result.usersDeferred += 1;
        continue;
      }
      await this.spaceDb.routedKysely
        .updateTable('notification_dispatch_log')
        .set({ status: 'digest-sent' })
        .where('id', 'in', sendable.map((r) => r.id))
        .where('status', '=', 'digest-queued')
        .execute();
      result.usersSent += 1;
      result.itemsSent += count;
    }
    return result;
  }
}
