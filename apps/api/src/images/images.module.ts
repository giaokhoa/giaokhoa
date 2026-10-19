import { ImagesService } from '@giaokhoa/application/images/service';
import { PostgresImagesRepository } from '@giaokhoa/database/images';
import type { Database } from '@giaokhoa/database/types';
import { Module } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { ImagesController } from './images.controller.js';
import { S3ImageStorage } from './s3-image-storage.js';

@Module({
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
      inject: [PostgresImagesRepository, S3ImageStorage],
      useFactory: (repository: PostgresImagesRepository, storage: S3ImageStorage) =>
        new ImagesService(repository, storage),
    },
  ],
})
export class ImagesModule {}
