import { afterAll, describe, expect, it, vi } from 'vitest';
import i18n, {
  appResources,
  dashboardResources,
  guardianResources,
  platformResources,
} from '#config/i18n';
import { enResources } from '#config/i18n-en';

const NAMESPACES = ['platform', 'app', 'dashboard', 'guardian'] as const;

const vietnameseBundles = {
  platform: platformResources.vi.platform,
  app: appResources.vi.app,
  dashboard: dashboardResources.vi.dashboard,
  guardian: guardianResources.vi.guardian,
} as const;

afterAll(async () => {
  await i18n.changeLanguage('vi');
});

describe('i18n — catalog mặc định tiếng Việt', () => {
  it('khởi tạo ở tiếng Việt và tra được chuỗi tiếng Việt ở cả bốn namespace', () => {
    expect(i18n.language).toBe('vi');
    expect(i18n.t('loading', { ns: 'platform' })).toBe('Đang tải…');
    expect(i18n.t('navProfile', { ns: 'app' })).toBe('Hồ sơ');
    expect(i18n.t('itemDashboard', { ns: 'dashboard' })).toBe('Tổng quan');
    expect(i18n.t('digestOff', { ns: 'guardian' })).toBe('Tắt');
  });
});

describe('i18n — catalog tiếng Anh nạp lười', () => {
  it('catalog en có đúng tập khoá của catalog vi ở cả bốn namespace', () => {
    for (const ns of NAMESPACES) {
      expect(Object.keys(enResources[ns]).sort()).toEqual(
        Object.keys(vietnameseBundles[ns]).sort(),
      );
    }
  });

  it('trước khi chuyển ngôn ngữ, kho tài nguyên chưa hề có chuỗi tiếng Anh', () => {
    expect(i18n.hasResourceBundle('en', 'app')).toBe(false);
    expect(i18n.hasResourceBundle('en', 'platform')).toBe(false);
  });

  it('chuyển sang en thì nạp đủ mọi khoá của cả bốn namespace, không thiếu khoá nào', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(enResources[ns])) {
        expect(i18n.getResource('en', ns, key)).toBe(value);
      }
    }
    expect(i18n.t('loading', { ns: 'platform' })).toBe('Loading…');
    expect(i18n.t('navProfile', { ns: 'app' })).toBe('Profile');
  });

  it('chuyển về vi sau khi đã nạp en vẫn tra đúng chuỗi tiếng Việt', async () => {
    await i18n.changeLanguage('vi');
    expect(i18n.t('loading', { ns: 'platform' })).toBe('Đang tải…');
    expect(i18n.t('itemDashboard', { ns: 'dashboard' })).toBe('Tổng quan');
  });
});

describe('i18n — nạp lười catalog tiếng Anh gặp lỗi rồi thử lại', () => {
  it('lần nạp đầu lỗi thì lần chuyển sang en sau đó nạp lại thành công thay vì kẹt ở promise đã reject', async () => {
    vi.resetModules();
    vi.doMock('#config/i18n-en', () => {
      throw new Error('Không tải được chunk catalog tiếng Anh');
    });
    const { default: freshI18n } = await import('#config/i18n');

    await freshI18n.changeLanguage('en');
    expect(freshI18n.hasResourceBundle('en', 'app')).toBe(false);
    expect(freshI18n.hasResourceBundle('en', 'platform')).toBe(false);

    vi.doUnmock('./i18n-en');
    await freshI18n.changeLanguage('vi');
    await freshI18n.changeLanguage('en');
    expect(freshI18n.language).toBe('en');
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(enResources[ns])) {
        expect(freshI18n.getResource('en', ns, key)).toBe(value);
      }
    }
    expect(freshI18n.t('loading', { ns: 'platform' })).toBe('Loading…');
  }, 30_000);
});
