import { Module } from '@nestjs/common';
import { ContentRepository } from '@giaokhoa/db/repositories/content';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CompletionModule } from '../completion/completion.module';
import { CoursesModule } from '../courses/courses.module';
import { FilesModule } from '../files/files.module';
import {
  CoursePagesController, CourseResourcesController, PagesController, PlayerController, ResourcesController,
} from './content.controller';
import { ContentService } from './content.service';
import { SystemBankModule } from '../system-bank/system-bank.module';

@Module({
  imports: [AccessModule, CoursesModule, CompletionModule, FilesModule, EventsModule, SpaceRoutingModule, SystemBankModule],
  controllers: [CoursePagesController, PagesController, CourseResourcesController, ResourcesController, PlayerController],
  providers: [
    {
      provide: ContentRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new ContentRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    ContentService,
  ],
  exports: [ContentService],
})
export class ContentModule {}
