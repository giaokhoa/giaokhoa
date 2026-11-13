import { Module } from '@nestjs/common';
import { DashboardRepository, type ContextLevels } from '@giaokhoa/db/repositories/dashboard';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CONTEXT_LEVELS } from '../access/domain/capabilities';
import { GradesModule } from '../grades/grades.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

const CONTEXT_LEVELS_PORT = 'CONTEXT_LEVELS_PORT';

@Module({
  imports: [AccessModule, GradesModule, SpaceRoutingModule],
  controllers: [DashboardController],
  providers: [
    { provide: CONTEXT_LEVELS_PORT, useValue: CONTEXT_LEVELS },
    {
      provide: DashboardRepository,
      useFactory: (spaceDb: SpaceDatabaseService, contextLevels: ContextLevels) =>
        new DashboardRepository(spaceDb.routedKysely, contextLevels),
      inject: [SpaceDatabaseService, CONTEXT_LEVELS_PORT],
    },
    DashboardService,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
