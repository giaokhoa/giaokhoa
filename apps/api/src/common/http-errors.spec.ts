import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
  unauthorized,
  unprocessableEntity,
} from './http-errors';

const cases: Array<{
  fn: (message: string, code: string) => never;
  exception: new (body: { message: string; code: string }) => HttpException;
  status: number;
}> = [
  { fn: badRequest, exception: BadRequestException, status: 400 },
  { fn: unauthorized, exception: UnauthorizedException, status: 401 },
  { fn: forbidden, exception: ForbiddenException, status: 403 },
  { fn: notFound, exception: NotFoundException, status: 404 },
  { fn: conflict, exception: ConflictException, status: 409 },
  {
    fn: unprocessableEntity,
    exception: UnprocessableEntityException,
    status: 422,
  },
  {
    fn: serviceUnavailable,
    exception: ServiceUnavailableException,
    status: 503,
  },
];

describe('Helper throw dùng chung', () => {
  it.each(cases)(
    'ném đúng loại exception với đúng message và code đã truyền (status $status)',
    ({ fn, exception, status }) => {
      let caught: unknown;
      try {
        fn('Không tìm thấy bản ghi', 'example.not_found');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(exception);
      const httpError = caught as HttpException;
      expect(httpError.getStatus()).toBe(status);
      expect(httpError.getResponse()).toEqual({
        message: 'Không tìm thấy bản ghi',
        code: 'example.not_found',
      });
    },
  );

  it('giữ nguyên message dạng template đã nội suy khi ném lỗi', () => {
    const id = '42';
    let caught: unknown;
    try {
      notFound(`Bản ghi ${id} không tồn tại`, 'example.not_found');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as HttpException).getResponse()).toEqual({
      message: 'Bản ghi 42 không tồn tại',
      code: 'example.not_found',
    });
  });
});
