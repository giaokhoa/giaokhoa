import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { PostgresAuthorizationRepository } from '@giaokhoa/database/authorization';
import type { Database } from '@giaokhoa/database/types';
import { Logger, Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationController } from './authorization.controller.js';

const logger = new Logger('Authorization');

@Module({
  controllers: [AuthorizationController],
  providers: [
    {
      provide: PostgresAuthorizationRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresAuthorizationRepository(db),
    },
    {
      provide: AuthorizationService,
      inject: [PostgresAuthorizationRepository],
      useFactory: (repository: PostgresAuthorizationRepository) =>
        new AuthorizationService(repository, (event) => {
          if (!event.allowed || event.capability === 'class:manage_any')
            logger.warn(JSON.stringify(event));
        }),
    },
  ],
  exports: [AuthorizationService, PostgresAuthorizationRepository],
})
export class AuthorizationModule {}
