import { Module } from '@nestjs/common';
import { BackupRepository } from '@giaokhoa/db/repositories/backup';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { FilesModule } from '../files/files.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [AccessModule, CoursesModule, FilesModule, SpaceRoutingModule],
  controllers: [BackupController],
  providers: [
    {
      provide: BackupRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new BackupRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    BackupService,
  ],
  exports: [BackupService],
})
export class BackupModule {}
