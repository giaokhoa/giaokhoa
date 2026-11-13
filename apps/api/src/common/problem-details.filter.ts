import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ProblemDetails } from '@giaokhoa/contracts';
import { t } from '@nestjs/i18n';
import type { Response } from 'express';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code = 'http.internal_error';
    let errors: ProblemDetails['errors'];
    let blockedStudents: ProblemDetails['blockedStudents'];
    let matrixImportIssues: ProblemDetails['matrixImportIssues'];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      title = STATUS_TITLES[status] ?? 'Error';
      code = `http.${title.toLowerCase().replace(/\s+/g, '_')}`;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          detail = 'Validation failed';
          errors = record.message.map((issue) => {
            // Pipe Standard Schema truyền thông điệp đã dịch và path có
            // cấu trúc; các exception cũ vẫn dùng chuỗi thông điệp.
            if (issue && typeof issue === 'object') {
              const item = issue as Record<string, unknown>;
              return {
                message: typeof item.message === 'string' ? item.message : String(item.message),
                ...(typeof item.field === 'string' ? { field: item.field } : {}),
              };
            }
            return { message: String(issue) };
          });
          code = 'http.validation_failed';
        } else if (typeof record.message === 'string') {
          detail = record.message;
        }
        if (typeof record.code === 'string') {
          code = record.code;
        }
        if (Array.isArray(record.blocked)) {
          const shaped = record.blocked.filter(
            (b): b is { userId: string; reason: 'awaiting_makeup' | 'incomplete'; roles: string[] } =>
              !!b && typeof b === 'object'
              && typeof (b as { userId?: unknown }).userId === 'string'
              && ((b as { reason?: unknown }).reason === 'awaiting_makeup' || (b as { reason?: unknown }).reason === 'incomplete')
              && Array.isArray((b as { roles?: unknown }).roles),
          );
          if (shaped.length > 0) {
            blockedStudents = shaped.map((b) => ({
              userId: b.userId,
              reason: b.reason,
              roles: b.roles.map((r) => String(r)),
            }));
          }
        }
        if (Array.isArray(record.matrixImportIssues)) {
          const shaped = record.matrixImportIssues.filter(
            (i): i is { sheet: string | null; row: number | null; column: string | null; code: string; message: string } =>
              !!i && typeof i === 'object'
              && ((i as { sheet?: unknown }).sheet === null || typeof (i as { sheet?: unknown }).sheet === 'string')
              && ((i as { row?: unknown }).row === null || typeof (i as { row?: unknown }).row === 'number')
              && ((i as { column?: unknown }).column === null || typeof (i as { column?: unknown }).column === 'string')
              && typeof (i as { code?: unknown }).code === 'string'
              && typeof (i as { message?: unknown }).message === 'string',
          );
          if (shaped.length > 0) matrixImportIssues = shaped;
        }
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      detail = 'An unexpected error occurred';
    }

    try {
      const key = `errors.${code}`;
      const translated = t(key as never);
      if (typeof translated === 'string' && translated !== key) detail = translated;
    } catch {
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title,
      status,
      detail,
      instance: request?.url,
      code,
      ...(errors ? { errors } : {}),
      ...(blockedStudents ? { blockedStudents } : {}),
      ...(matrixImportIssues ? { matrixImportIssues } : {}),
    };

    response
      .status(status)
      .type('application/problem+json')
      .json(problem);
  }
}
