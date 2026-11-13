import { encodeVietQr } from 'vn-qr-pay';


export const PAYMENT_CODE_PREFIX = 'GKH';
export const PAYMENT_CODE_TTL_MS = 24 * 60 * 60 * 1000;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function paymentCodeFromSequence(seq: number): string {
  let n = Math.floor(Math.abs(seq));
  let encoded = '';
  do {
    encoded = CROCKFORD[n % 32] + encoded;
    n = Math.floor(n / 32);
  } while (n > 0);
  return PAYMENT_CODE_PREFIX + encoded.padStart(9, '0');
}

const PAYMENT_CODE_RE = /GKH[0-9A-HJKMNP-TV-Z]{9}/;

export function extractPaymentCode(content: string): string | null {
  const normalized = content.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = normalized.match(PAYMENT_CODE_RE);
  return match ? match[0] : null;
}

export interface PaymentAccountConfig {
  bankBin?: string;
  bankCode?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  sepayApiKey?: string;
  sepayBankAccountXid?: string;
  [key: string]: unknown;
}

const BIN_TO_BANK_KEY: Record<string, string> = {
  '970422': 'MBBANK',
  '970436': 'VIETCOMBANK',
  '970415': 'VIETINBANK',
  '970407': 'TECHCOMBANK',
  '970418': 'BIDV',
  '970405': 'AGRIBANK',
  '970416': 'ACB',
  '970432': 'VPBANK',
  '970423': 'TPBANK',
  '970403': 'SACOMBANK',
  '970428': 'MSB',
  '970441': 'VIB',
  '970443': 'SHB',
  '970431': 'EXIMBANK',
  '970414': 'OCB',
  '970449': 'LIENVIETPOST_BANK',
  '970437': 'HDBANK',
};

export function readAccountConfig(raw: unknown): PaymentAccountConfig {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PaymentAccountConfig) : {};
}

export function buildVietQrPayload(account: { gateway: string; config: unknown }, amount: number, paymentCode: string): string | null {
  const config = readAccountConfig(account.config);
  if (account.gateway !== 'sepay') return null;
  if (!config.sepayBankAccountXid) return null;
  const accountNumber = typeof config.bankAccountNumber === 'string' ? config.bankAccountNumber : '';
  if (!accountNumber) return null;
  const bankKey = (typeof config.bankCode === 'string' && config.bankCode) || (config.bankBin ? BIN_TO_BANK_KEY[config.bankBin] : undefined);
  if (!bankKey) return null;
  try {
    return encodeVietQr({
      bank: bankKey as never,
      account: accountNumber,
      amount: String(amount),
      additionalData: { purpose: paymentCode },
    });
  } catch {
    return null;
  }
}

const SENSITIVE_KEY_RE = /(api[-_]?key|secret|checksum|password|token)/i;

export function maskAccountConfig(raw: unknown): Record<string, unknown> {
  const config = readAccountConfig(raw);
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      masked[key] = typeof value === 'string' && value.length > 4 ? `••••••${value.slice(-4)}` : '••••••';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
