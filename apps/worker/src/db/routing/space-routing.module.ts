import { Module } from '@nestjs/common';
import { SpaceDatabaseService } from './space-database.service';
import { SpaceJobRunner } from './space-job-runner';

@Module({
  providers: [SpaceDatabaseService, SpaceJobRunner],
  exports: [SpaceDatabaseService, SpaceJobRunner],
})
export class SpaceRoutingModule {}
