import { Processor } from '@nestjs/bullmq';
import { ObservedWorkerHost } from '../observed-worker-host';
import { validateWorkerJobPayload, workerPayloadSchemas } from './job-payload-validation';
import type { Job } from 'bullmq';
import { SpaceJobRunner } from '../db/routing/space-job-runner';
import { ResendMailService } from '../resend-mail.service';
import { SpaceDatabaseService } from '../db/routing/space-database.service';

export interface NotificationDispatchJobData {
  spaceSlug?: string | null;
  spaceId?: string | null;
  userId: string;
  provider: string;
  channel: string;
  subject: string;
  body: string;
  notificationId?: string | null;
  dedupeKey: string;
  tenantId?: string | null;
  emailFrequency?: 'immediate' | 'daily' | 'off' | null;
}
export interface NotificationDispatchResult {
  status: 'logged' | 'sent' | 'digest-queued' | 'skipped-not-configured' | 'skipped-suspended' | 'skipped-preference' | 'skipped-admin-disabled' | 'duplicate';
  channel: string;
}

const MANDATORY_PROVIDERS = new Set(['enrol_expiry_warning', 'admin_announcement']);

@Processor('notification-dispatch', { concurrency: 10 })
export class NotificationDispatchProcessor extends ObservedWorkerHost {
  constructor(
    private readonly spaceDb: SpaceDatabaseService,
    private readonly mail: ResendMailService,
    private readonly jobRunner: SpaceJobRunner,
  ) { super(); }

  async process(job: Job<NotificationDispatchJobData>): Promise<NotificationDispatchResult> {

    validateWorkerJobPayload(workerPayloadSchemas['notification-dispatch'], job.data, 'notification-dispatch');
    return this.jobRunner.runForJob(job.data, () => this.processInContext(job));
  }

  private async processInContext(job: Job<NotificationDispatchJobData>): Promise<NotificationDispatchResult> {
    const { userId, provider, channel, subject, dedupeKey } = job.data;
    const tenantId = job.data.tenantId ?? null;
    const existing = await this.spaceDb.routedKysely
      .selectFrom('notification_dispatch_log')
      .select('id')
      .where('dedupe_key', '=', dedupeKey)
      .executeTakeFirst();
    if (existing) return { status: 'duplicate', channel };

    const user = await this.spaceDb.routedKysely
      .selectFrom('users')
      .select(['suspended', 'deleted', 'email'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.suspended || user.deleted) {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider, channel, status: 'skipped-suspended', subject, dedupe_key: dedupeKey, tenant_id: tenantId,
        notification_id: job.data.notificationId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-suspended', channel };
    }
    if (!MANDATORY_PROVIDERS.has(provider)) {
      const policy = await this.spaceDb.routedKysely
        .selectFrom('plugin_config')
        .select('value')
        .where('plugin', '=', 'notifications')
        .where('name', '=', `provider_${provider}_enabled`)
        .where('tenant_id', 'is', null)
        .executeTakeFirst();
      let adminDisabled = false;
      if (policy && policy.value !== null) {
        try { adminDisabled = JSON.parse(policy.value) === false; } catch { adminDisabled = false; }
      }
      if (adminDisabled) {
        await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
          user_id: userId, provider, channel, status: 'skipped-admin-disabled', subject, dedupe_key: dedupeKey, tenant_id: tenantId,
          notification_id: job.data.notificationId ?? null,
        }).onConflict((oc) => oc.doNothing()).execute();
        return { status: 'skipped-admin-disabled', channel };
      }
    }
    const prefName = (state: string) => `message_provider_${provider}_${channel}_${state}`;
    const prefs = await this.spaceDb.routedKysely
      .selectFrom('user_preferences')
      .select(['name', 'value'])
      .where('user_id', '=', userId)
      .execute();
    const byName = new Map(prefs.map((p) => [p.name, p.value]));
    const loggedin = byName.get(prefName('loggedin')) !== '0';
    const loggedoff = byName.get(prefName('loggedoff')) !== '0';
    if (!loggedin && !loggedoff) {
      await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
        user_id: userId, provider, channel, status: 'skipped-preference', subject, dedupe_key: dedupeKey, tenant_id: tenantId,
        notification_id: job.data.notificationId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();
      return { status: 'skipped-preference', channel };
    }
    if (channel === 'email') {
      return this.dispatchEmail(job, user.email, byName);
    }
    await this.spaceDb.routedKysely.insertInto('notification_dispatch_log').values({
      user_id: userId, provider, channel, status: 'logged', subject, dedupe_key: dedupeKey, tenant_id: tenantId,
      notification_id: job.data.notificationId ?? null,
    }).onConflict((oc) => oc.doNothing()).execute();
    return { status: 'logged', channel };
  }

  private async dispatchEmail(
    job: Job<NotificationDispatchJobData>,
    recipientEmail: string,
    preferencesByName: Map<string, string | null>,
  ): Promise<NotificationDispatchResult> {
    const { userId, provider, channel, subject, dedupeKey } = job.data;
    const tenantId = job.data.tenantId ?? null;
    const logRow = (status: NotificationDispatchResult['status']) => this.spaceDb.routedKysely
      .insertInto('notification_dispatch_log').values({
        user_id: userId, provider, channel, status, subject, dedupe_key: dedupeKey, tenant_id: tenantId,
        notification_id: job.data.notificationId ?? null,
      }).onConflict((oc) => oc.doNothing()).execute();

    if (preferencesByName.get(`message_provider_${provider}_email_v2`) === 'off') {
      await logRow('skipped-preference');
      return { status: 'skipped-preference', channel };
    }
    if ((job.data.emailFrequency ?? 'immediate') === 'daily') {
      await logRow('digest-queued');
      return { status: 'digest-queued', channel };
    }
    const result = await this.mail.send({ to: recipientEmail, subject, text: job.data.body });
    if (result.status === 'skipped') {
      await logRow('skipped-not-configured');
      return { status: 'skipped-not-configured', channel };
    }
    await logRow('sent');
    return { status: 'sent', channel };
  }
}
