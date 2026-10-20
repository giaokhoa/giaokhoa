import type { ArgumentsHost } from '@nestjs/common';
import { ClientError } from '@giaokhoa/application/common/client-error';
import { describe, expect, it, vi } from 'vitest';
import { ClientErrorFilter } from './client-error.filter.js';

describe('ClientErrorFilter authorization responses', () => {
  it.each([
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('maps %s to HTTP %d', (kind, code) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new ClientErrorFilter().catch(
      new ClientError(kind, 'authorization_denied', 'Không có quyền'),
      host,
    );

    expect(status).toHaveBeenCalledWith(code);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: code }));
  });
});
