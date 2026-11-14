import { describe, expect, it } from 'vitest';
import { resolveDarkTheme } from './theme';

describe('Giao diện sáng/tối', () => {
  it('chế độ system theo hệ điều hành, lựa chọn thủ công luôn có ưu tiên', () => {
    expect(resolveDarkTheme('system', true)).toBe(true);
    expect(resolveDarkTheme('system', false)).toBe(false);
    expect(resolveDarkTheme('light', true)).toBe(false);
    expect(resolveDarkTheme('dark', false)).toBe(true);
  });
});
