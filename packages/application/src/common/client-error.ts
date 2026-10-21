export type ClientErrorKind = 'invalid' | 'not_found' | 'conflict' | 'forbidden';

/** Lỗi nghiệp vụ có mã ổn định; tầng giao tiếp tự ánh xạ loại lỗi sang trạng thái giao thức. */
export class ClientError extends Error {
  constructor(
    public readonly kind: ClientErrorKind,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = ClientError.name;
  }
}
