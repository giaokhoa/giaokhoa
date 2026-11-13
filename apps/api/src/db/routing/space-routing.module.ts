import { Module } from '@nestjs/common';
import { ControlPlaneConnectionModule } from '../control-plane-connection.module';
import { SpaceDatabaseService } from './space-database.service';

@Module({
  imports: [ControlPlaneConnectionModule],
  providers: [SpaceDatabaseService],
  exports: [SpaceDatabaseService],
})
export class SpaceRoutingModule {}
