import { describe, expect, it } from 'vitest';
import { decodeQr } from 'vn-qr-pay';
import { buildVietQrPayload } from './vietqr';

const SEPAY_XID = 'xid-test-org-001';
const BANK_ACCOUNT = '113366668888';

describe('VietQR — sinh payload QR động', () => {
  it('payload khớp vector vàng của hệ thống từng byte và giải mã ngược đúng số tiền, tài khoản và nội dung chuyển khoản', () => {
    const payload = buildVietQrPayload(
      { gateway: 'sepay', config: { bankCode: 'MBBANK', bankAccountNumber: BANK_ACCOUNT, sepayBankAccountXid: SEPAY_XID } },
      100000, 'GKH7K3QX9P2M',
    );
    expect(payload).toBe('00020101021238560010A0000007270126000697042201121133666688880208QRIBFTTA530370454061000005802VN62160812GKH7K3QX9P2M6304EC92');
    const decoded = decodeQr(payload!);
    expect(decoded.isValid).toBe(true);
    expect(decoded.amount).toBe('100000');
    expect(decoded.consumer.bankNumber).toBe(BANK_ACCOUNT);
    expect((decoded.additionalData as { purpose?: string }).purpose).toBe('GKH7K3QX9P2M');
  });
});
