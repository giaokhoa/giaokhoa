import { AuthorizationService } from '@giaokhoa/application/authorization/service';
import { ImagesService } from '@giaokhoa/application/images/service';
import { PostgresImagesRepository } from '@giaokhoa/database/images';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ImagesController } from './images.controller.js';
import { S3ImageStorage } from './s3-image-storage.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ImagesController],
  providers: [
    S3ImageStorage,
    {
      provide: PostgresImagesRepository,
      inject: [getDrizzleToken()],
      useFactory: (db: Database) => new PostgresImagesRepository(db),
    },
    {
      provide: ImagesService,
      inject: [PostgresImagesRepository, S3ImageStorage, AuthorizationService],
      useFactory: (
        repository: PostgresImagesRepository,
        storage: S3ImageStorage,
        authorization: AuthorizationService,
      ) => new ImagesService(repository, storage, authorization),
    },
  ],
})
export class ImagesModule {}
