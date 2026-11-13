import { describe, expect, it, vi } from 'vitest';
import {
  NotificationDeliveryService,
  WORKER_PROVIDERS,
  type WorkerProviderLaw,
} from './notification-delivery.service';


describe('Đối chiếu thông báo: worker mirror kiểm tra tỉnh táo cục bộ (issue #293)', () => {
  it('mọi mục mirror đều khoá theo đúng tên provider của nó', () => {
    const entries = Object.entries(WORKER_PROVIDERS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, law] of entries) {
      expect(law.name).toBe(key);
    }
  });
});

function buildDelivery(scenario: {
  user?: { id: string; suspended: boolean; deleted: boolean };
  preferenceValue?: string;
  sitePolicyValue?: string;
}) {
  const insertedNotifications: Record<string, unknown>[] = [];
  const insertedLogs: Record<string, unknown>[] = [];
  const rowFor = (table: string): Record<string, unknown> | undefined => {
    if (table === 'users') return scenario.user as unknown as Record<string, unknown> | undefined;
    if (table === 'plugin_config') return scenario.sitePolicyValue === undefined ? undefined : { value: scenario.sitePolicyValue };
    if (table === 'user_preferences') return scenario.preferenceValue === undefined ? undefined : { value: scenario.preferenceValue };
    return undefined;
  };
  const selectBuilder = (table: string) => {
    const builder = {
      select: () => builder,
      where: () => builder,
      executeTakeFirst: async () => rowFor(table),
      execute: async () => {
        const row = rowFor(table);
        return row ? [row] : [];
      },
    };
    return builder;
  };
  const insertBuilder = (table: string) => ({
    values: (v: Record<string, unknown>) => {
      if (table === 'notifications') {
        insertedNotifications.push(v);
        return {
          returning: () => ({ executeTakeFirst: async () => ({ id: 'notif-parity-1' }) }),
        };
      }
      insertedLogs.push(v);
      return {
        onConflict: () => ({ execute: async () => [] }),
        execute: async () => [],
      };
    },
  });
  const routedKysely = {
    selectFrom: (table: string) => selectBuilder(table),
    insertInto: (table: string) => insertBuilder(table),
  };
  const config = { getOrThrow: () => 'redis://localhost:6379' };
  const delivery = new NotificationDeliveryService({ routedKysely } as never, config as never);
  (delivery as unknown as { signalUnreadCountChanged: (userId: string) => Promise<void> })
    .signalUnreadCountChanged = vi.fn(async () => undefined);
  return { delivery, insertedNotifications, insertedLogs };
}

const ACTIVE_USER = { id: 'user-parity', suspended: false, deleted: false };
const CALENDAR_INPUT = { subject: 'Nhắc lịch', body: 'Nội dung nhắc', smallMessage: 'Nhắc lịch' };

describe('Đối chiếu thông báo: luật gửi của worker khớp luật cứng phía API (issue #293)', () => {
  it('người nhận bị đình chỉ thì bị bỏ qua và không lưu gì — giống notify() phía API', async () => {
    const { delivery, insertedNotifications, insertedLogs } = buildDelivery({
      user: { id: 'user-parity', suspended: true, deleted: false },
    });
    const result = await delivery.deliverInApp('user-parity', 'calendar_reminder', CALENDAR_INPUT);
    expect(result.status).toBe('skipped-suspended');
    expect(insertedNotifications).toHaveLength(0);
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]).toMatchObject({ provider: 'calendar_reminder', channel: 'popup', status: 'skipped-suspended' });
  });

  it('người nhận không còn tồn tại cũng bị bỏ qua theo cùng cách', async () => {
    const { delivery, insertedNotifications } = buildDelivery({});
    const result = await delivery.deliverInApp('user-gone', 'calendar_reminder', CALENDAR_INPUT);
    expect(result.status).toBe('skipped-suspended');
    expect(insertedNotifications).toHaveLength(0);
  });

  it('provider bị chính sách site admin tắt (NB-7) thì bị bỏ qua trước khi xét tuỳ chọn người dùng', async () => {
    const { delivery, insertedNotifications, insertedLogs } = buildDelivery({
      user: ACTIVE_USER, sitePolicyValue: 'false',
    });
    const result = await delivery.deliverInApp('user-parity', 'calendar_reminder', CALENDAR_INPUT);
    expect(result.status).toBe('skipped-admin-disabled');
    expect(insertedNotifications).toHaveLength(0);
    expect(insertedLogs[0]).toMatchObject({ provider: 'calendar_reminder', status: 'skipped-admin-disabled' });
  });

  it('người nhận đã tắt provider trong app thì bị bỏ qua theo tuỳ chọn', async () => {
    const { delivery, insertedNotifications, insertedLogs } = buildDelivery({
      user: ACTIVE_USER, preferenceValue: '0',
    });
    const result = await delivery.deliverInApp('user-parity', 'calendar_reminder', CALENDAR_INPUT);
    expect(result.status).toBe('skipped-preference');
    expect(insertedNotifications).toHaveLength(0);
    expect(insertedLogs[0]).toMatchObject({ provider: 'calendar_reminder', status: 'skipped-preference' });
  });

  it('người nhận đang bật và không có tuỳ chọn chặn sẽ nhận thông báo kèm log gửi đã giao', async () => {
    const { delivery, insertedNotifications, insertedLogs } = buildDelivery({ user: ACTIVE_USER });
    const result = await delivery.deliverInApp('user-parity', 'calendar_reminder', CALENDAR_INPUT);
    expect(result.status).toBe('delivered');
    expect(result.notificationId).toBe('notif-parity-1');
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({ event_type: 'calendar_reminder', component: 'core_calendar' });
    expect(insertedLogs[0]).toMatchObject({ provider: 'calendar_reminder', status: 'delivered', dedupe_key: 'popup-notif-parity-1' });
  });

  it('provider bắt buộc (P2) ép bật kênh in-app ngay cả khi tuỳ chọn đã lưu đang tắt — đúng luật phía API', async () => {
    const mandatory: WorkerProviderLaw = { name: 'parity_mandatory_probe', component: 'core_probe', mandatoryInApp: true };
    const optional: WorkerProviderLaw = { name: 'parity_optional_probe', component: 'core_probe', mandatoryInApp: false };
    const { delivery } = buildDelivery({ user: ACTIVE_USER, preferenceValue: '0' });
    expect(await delivery.resolvePopupEnabled('user-parity', mandatory)).toBe(true);
    expect(await delivery.resolvePopupEnabled('user-parity', optional)).toBe(false);
  });

  it('provider bắt buộc (P2) vẫn gửi đầu-cuối ngay cả khi chính sách site admin tắt nó và tuỳ chọn đã lưu đang tắt', async () => {
    WORKER_PROVIDERS['parity_mandatory_probe'] = { name: 'parity_mandatory_probe', component: 'core_probe', mandatoryInApp: true };
    WORKER_PROVIDERS['parity_optional_probe'] = { name: 'parity_optional_probe', component: 'core_probe', mandatoryInApp: false };
    try {
      const { delivery, insertedNotifications, insertedLogs } = buildDelivery({
        user: ACTIVE_USER, sitePolicyValue: 'false', preferenceValue: '0',
      });
      const mandatoryResult = await delivery.deliverInApp('user-parity', 'parity_mandatory_probe', CALENDAR_INPUT);
      expect(mandatoryResult.status).toBe('delivered');
      expect(insertedNotifications).toHaveLength(1);
      expect(insertedNotifications[0]).toMatchObject({ event_type: 'parity_mandatory_probe', component: 'core_probe' });
      const optionalResult = await delivery.deliverInApp('user-parity', 'parity_optional_probe', CALENDAR_INPUT);
      expect(optionalResult.status).toBe('skipped-admin-disabled');
      expect(insertedNotifications).toHaveLength(1);
      expect(insertedLogs.map((l) => l.status)).toEqual(['delivered', 'skipped-admin-disabled']);
    } finally {
      delete WORKER_PROVIDERS['parity_mandatory_probe'];
      delete WORKER_PROVIDERS['parity_optional_probe'];
    }
  });
});
