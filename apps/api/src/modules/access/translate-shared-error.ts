import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SharedDomainError } from '@giaokhoa/enrol';


const NOT_FOUND_CODES = new Set(['access.role_not_found', 'access.context_not_found', 'course.context_missing']);

export function translateSharedDomainError(err: unknown): unknown {
  if (err instanceof SharedDomainError) {
    const body = { message: err.message, code: err.code };
    return NOT_FOUND_CODES.has(err.code) ? new NotFoundException(body) : new BadRequestException(body);
  }
  return err;
}

export async function delegateToSharedCore<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw translateSharedDomainError(err);
  }
}
