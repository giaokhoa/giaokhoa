export type ClientErrorKind = 'invalid' | 'not_found' | 'conflict' | 'forbidden';

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
