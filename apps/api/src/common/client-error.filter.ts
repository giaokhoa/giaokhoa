import { ClientError } from '@giaokhoa/application/common/client-error';
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

@Catch(ClientError)
export class ClientErrorFilter implements ExceptionFilter {
  catch(error: ClientError, host: ArgumentsHost) {
    const httpError = this.toHttpError(error);
    const response = host.switchToHttp().getResponse();
    response.status(httpError.getStatus()).json(httpError.getResponse());
  }

  private toHttpError(error: ClientError) {
    switch (error.kind) {
      case 'invalid':
        return new BadRequestException(error.details ?? error.message);
      case 'not_found':
        return new NotFoundException(error.message);
      case 'conflict':
        return new ConflictException(error.message);
      case 'forbidden':
        return new ForbiddenException(error.message);
    }
  }
}
