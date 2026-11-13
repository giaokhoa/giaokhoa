import { describe, expect, it } from 'vitest';
import { SystemBankNotConfiguredError, SystemBankRepository } from './system-bank';

describe('SystemBankRepository khi chưa cấu hình', () => {
  it('thao tác đọc ném lỗi mang mã system_bank.not_configured', async () => {
    const repo = new SystemBankRepository(null);
    await expect(repo.getQuestion('01958500-0000-7000-8000-000000000001')).rejects.toBeInstanceOf(
      SystemBankNotConfiguredError,
    );
    await expect(repo.getQuestion('01958500-0000-7000-8000-000000000001')).rejects.toMatchObject({
      code: 'system_bank.not_configured',
    });
  });

  it('thao tác ghi cũng ném lỗi chưa cấu hình thay vì chạm database', async () => {
    const repo = new SystemBankRepository(null);
    await expect(
      repo.recordEvent({ type: 'question_withdrawn', sourceQuestionId: 'q1', payload: {} }),
    ).rejects.toMatchObject({ code: 'system_bank.not_configured' });
  });

  it('hàm dựng lỗi do tầng ứng dụng cấp được dùng thay lỗi mặc định của package', async () => {
    const appError = new Error('app-specific not configured');
    const repo = new SystemBankRepository(null, () => appError);
    await expect(repo.listPackages()).rejects.toBe(appError);
  });
});
