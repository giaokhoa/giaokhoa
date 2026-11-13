import { Module } from '@nestjs/common';
import { McpIdempotencyRepository } from '@giaokhoa/db/repositories/mcp-idempotency';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { BetterAuthModule } from '../auth/better-auth/better-auth.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { ExamsModule } from '../exams/exams.module';
import { QuestionsModule } from '../questions/questions.module';
import { QuizModule } from '../quiz/quiz.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { McpDepsService } from './mcp-deps.service';

@Module({
  imports: [QuestionsModule, UsersModule, EventsModule, BetterAuthModule, CurriculumModule, TenantsModule, ExamsModule, QuizModule, SpaceRoutingModule],
  providers: [
    {
      provide: McpIdempotencyRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new McpIdempotencyRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    McpDepsService,
  ],
  exports: [McpDepsService],
})
export class McpModule {}
