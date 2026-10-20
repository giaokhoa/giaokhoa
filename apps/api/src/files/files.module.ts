import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { FilesService } from '@giaokhoa/application/files/service';
import { PostgresFilesRepository } from '@giaokhoa/database/files';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FilesController } from './files.controller.js';
import { S3FileStorage } from './s3-file-storage.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [FilesController],
  providers: [
    S3FileStorage,
    {
      provide: PostgresFilesRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresFilesRepository(db),
    },
    {
      provide: FilesService,
      inject: [PostgresFilesRepository, S3FileStorage, AuthorizationService],
      useFactory: (
        repository: PostgresFilesRepository,
        storage: S3FileStorage,
        authorization: AuthorizationService,
      ) => new FilesService(repository, storage, authorization),
    },
  ],
})
export class FilesModule {}
