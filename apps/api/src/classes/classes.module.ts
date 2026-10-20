import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ClassesService } from '@giaokhoa/application/classes/service';
import { PostgresClassesRepository } from '@giaokhoa/database/classes';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ClassesController } from './classes.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ClassesController],
  providers: [
    {
      provide: PostgresClassesRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresClassesRepository(db),
    },
    {
      provide: ClassesService,
      inject: [PostgresClassesRepository, AuthorizationService],
      useFactory: (repository: PostgresClassesRepository, authorization: AuthorizationService) =>
        new ClassesService(repository, authorization),
    },
  ],
})
export class ClassesModule {}
