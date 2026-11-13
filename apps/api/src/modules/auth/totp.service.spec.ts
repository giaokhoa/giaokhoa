import type { ConfigService } from '@nestjs/config';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import type { AuthRepository, UserTotpRow } from '@giaokhoa/db/repositories/auth';
import { TotpService } from './totp.service';

/**
 * Cổng tái xác thực khi setup lại TOTP trên một factor ĐANG BẬT.
 *
 * Luật nghiệp vụ: khi factor đã bật, setup mới đòi mã hiện tại
 * và chỉ dựng pending replacement; chưa confirm thì giữ MFA đang bật.
 * Khi factor chưa bật, setup nhiều lần được phép thay pending secret;
 * xác nhận chỉ kích hoạt đúng secret đã được kiểm mã.
 * Kiểm chứng HTTP được đặt tại e2e Authentication.
 */

const USER_ID = '01900000-0000-7000-8000-0000000000aa';
const USERNAME = 'teacher1';

/** Kho lưu bản ghi TOTP trong bộ nhớ, mô phỏng đúng các thao tác repository mà service dùng. */
function buildService() {
  let row: UserTotpRow | undefined;
  let pending: string | undefined;
  const repo = {
    stageTotpReplacement: async (_userId: string, encryptedSecret: string) => { pending = encryptedSecret; },
    getPendingTotpReplacement: async () => pending,
    activateTotpReplacement: async (_userId: string, encryptedSecret: string) => {
      if (!row?.confirmed || encryptedSecret !== pending) return false;
      row = { ...row, secretEncrypted: encryptedSecret };
      pending = undefined;
      return true;
    },
    clearPendingTotpReplacement: async () => { pending = undefined; },
    getTotpByUserId: async () => row,
    upsertPendingTotp: async (userId: string, secretEncrypted: string) => {
      if (row?.confirmed) return undefined;
      row = {
        id: '01900000-0000-7000-8000-0000000000bb',
        userId,
        secretEncrypted,
        confirmed: false,
        createdAt: new Date(),
        confirmedAt: null,
      } as UserTotpRow;
      return row;
    },
    confirmTotp: async (_userId: string, encryptedSecret: string) => {
      if (!row || row.confirmed || row.secretEncrypted !== encryptedSecret) return false;
      row = { ...row, confirmed: true, confirmedAt: new Date() };
      return true;
    },
    deleteTotp: async () => {
      row = undefined;
    },
  } as unknown as AuthRepository;
  const config = {
    get: () => undefined,
    getOrThrow: () => 'unit-test-encryption-material',
  } as unknown as ConfigService;
  return { service: new TotpService(repo, config), storedRow: () => row };
}

/** Mã TOTP hiện tại cho secret, sinh bằng chính thư viện otplib đã cài. */
async function currentCode(secret: string): Promise<string> {
  return generate({ secret });
}

/** Một mã 6 số chắc chắn KHÔNG khớp cửa sổ kiểm chứng (±1 bước) của secret. */
async function wrongCode(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const valid = new Set<string>();
  for (const delta of [-30, 0, 30]) valid.add(await generate({ secret, epoch: now + delta }));
  for (const candidate of ['000000', '111111', '222222', '333333']) {
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error('no wrong-code candidate available');
}

/** Bắt lỗi ném ra và đọc mã lỗi ProblemDetails trong thân lỗi. */
async function thrownErrorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (err) {
    const response = (err as { getResponse?: () => { code?: string } }).getResponse?.();
    return response?.code;
  }
  throw new Error('expected the call to throw, but it succeeded');
}

/** Setup + confirm để đưa tài khoản về trạng thái MFA đang bật; trả secret đang hoạt động. */
async function enableFactor(service: TotpService): Promise<string> {
  const { secret } = await service.setup(USER_ID, USERNAME);
  await service.confirm(USER_ID, await currentCode(secret));
  return secret;
}

describe('Cổng tái xác thực khi thiết lập TotpService', () => {
  it('cho thiết lập lần đầu không cần mã và lưu factor đang chờ', async () => {
    const { service, storedRow } = buildService();
    const { secret, otpauthUrl } = await service.setup(USER_ID, USERNAME);
    expect(secret).toBeTruthy();
    expect(otpauthUrl).toContain('otpauth://totp/');
    expect(storedRow()?.confirmed).toBe(false);
    expect(await service.isEnabled(USER_ID)).toBe(false);
  });

  it('cho thiết lập lặp lại khi factor vẫn đang chờ, không cần mã', async () => {
    const { service, storedRow } = buildService();
    const first = await service.setup(USER_ID, USERNAME);
    const firstStored = storedRow()?.secretEncrypted;
    const second = await service.setup(USER_ID, USERNAME);
    expect(second.secret).not.toBe(first.secret);
    expect(storedRow()?.secretEncrypted).not.toBe(firstStored);
    expect(storedRow()?.confirmed).toBe(false);
    expect(await service.isEnabled(USER_ID)).toBe(false);
  });

  it('từ chối thiết lập lại không có mã hiện tại khi factor đang hoạt động và giữ nguyên factor đang hoạt động', async () => {
    const { service, storedRow } = buildService();
    const activeSecret = await enableFactor(service);
    const before = storedRow();
    expect(await service.isEnabled(USER_ID)).toBe(true);

    const code = await thrownErrorCode(() => service.setup(USER_ID, USERNAME));

    expect(code).toBe('auth.mfa_reauth_required');
    // Factor cũ nguyên vẹn: cùng bản ghi đã mã hoá, vẫn đang bật, mã của
    // authenticator hiện tại vẫn kiểm chứng được.
    expect(storedRow()).toEqual(before);
    expect(await service.isEnabled(USER_ID)).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(activeSecret))).toBe(true);
  });

  it('từ chối thiết lập lại với mã hiện tại sai khi factor đang hoạt động và giữ nguyên factor đang hoạt động', async () => {
    const { service, storedRow } = buildService();
    const activeSecret = await enableFactor(service);
    const before = storedRow();

    const wrong = await wrongCode(activeSecret);
    const code = await thrownErrorCode(() => service.setup(USER_ID, USERNAME, wrong));

    expect(code).toBe('auth.mfa_invalid_code');
    expect(storedRow()).toEqual(before);
    expect(await service.isEnabled(USER_ID)).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(activeSecret))).toBe(true);
  });

  it('thay factor khi thiết lập lại trình mã hiện tại đúng', async () => {
    const { service, storedRow } = buildService();
    const activeSecret = await enableFactor(service);

    const replacement = await service.setup(USER_ID, USERNAME, await currentCode(activeSecret));

    expect(replacement.secret).not.toBe(activeSecret);
    // Thiết bị mới đang chờ, nhưng factor cũ và cổng đăng nhập phải còn bật.
    expect(storedRow()?.confirmed).toBe(true);
    expect(await service.isEnabled(USER_ID)).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(activeSecret))).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(replacement.secret))).toBe(false);
    await service.confirm(USER_ID, await currentCode(replacement.secret));
    expect(await service.isEnabled(USER_ID)).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(replacement.secret))).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(activeSecret))).toBe(false);
  });

  it('bỏ dở việc thay thiết bị không hạ MFA và vẫn đăng nhập được bằng authenticator cũ', async () => {
    const { service, storedRow } = buildService();
    const activeSecret = await enableFactor(service);
    const before = storedRow();
    await service.setup(USER_ID, USERNAME, await currentCode(activeSecret));
    expect(storedRow()).toEqual(before);
    expect(await service.isEnabled(USER_ID)).toBe(true);
    expect(await service.verifyForUser(USER_ID, await currentCode(activeSecret))).toBe(true);
  });
});
