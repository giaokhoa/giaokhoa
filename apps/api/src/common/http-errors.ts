import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function badRequest(message: string, code: string): never {
  throw new BadRequestException({ message, code });
}

export function unauthorized(message: string, code: string): never {
  throw new UnauthorizedException({ message, code });
}

export function forbidden(message: string, code: string): never {
  throw new ForbiddenException({ message, code });
}

export function notFound(message: string, code: string): never {
  throw new NotFoundException({ message, code });
}

export function conflict(message: string, code: string): never {
  throw new ConflictException({ message, code });
}

export function unprocessableEntity(message: string, code: string): never {
  throw new UnprocessableEntityException({ message, code });
}

export function serviceUnavailable(message: string, code: string): never {
  throw new ServiceUnavailableException({ message, code });
}
