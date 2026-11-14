import { RequestMethod } from '@nestjs/common';

export const CSRF_EXCLUSIONS: { path: string; method: RequestMethod; version?: string }[] = [
  { path: 'payments/ipn/sepay', method: RequestMethod.POST, version: '1' },
  { path: 'payments/webhook', method: RequestMethod.POST, version: '1' },
  { path: 'webservice/call', method: RequestMethod.POST, version: '1' },
  { path: 'mcp', method: RequestMethod.POST },
];
