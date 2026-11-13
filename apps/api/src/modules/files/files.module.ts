import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesRepository } from '@giaokhoa/db/repositories/files';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { FileSigningService } from './file-signing.service';
import { FilesController } from './files.controller';
import { FilesListener } from './files.listener';
import { FILE_CLEANUP_QUEUE, FilesService } from './files.service';
import { OBJECT_STORAGE } from './storage';
import { createObjectStorage } from './storage-factory';

@Module({
  imports: [AccessModule, SpaceRoutingModule, BullModule.registerQueue({ name: FILE_CLEANUP_QUEUE })],
  controllers: [FilesController],
  providers: [
    {
      provide: FilesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new FilesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    FilesService, FileSigningService, FilesListener,
    { provide: OBJECT_STORAGE, useFactory: (config: ConfigService) => createObjectStorage(config), inject: [ConfigService] },
  ],
  exports: [FilesService, OBJECT_STORAGE],
})
export class FilesModule {}
