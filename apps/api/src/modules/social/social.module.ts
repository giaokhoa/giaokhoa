import { Module } from '@nestjs/common';
import { SocialRepository } from '@giaokhoa/db/repositories/social';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrolModule } from '../enrol/enrol.module';
import { GradesModule } from '../grades/grades.module';
import { CommentsService } from './comments.service';
import { NotesService } from './notes.service';
import { RatingsService } from './ratings.service';
import { CommentsController, NotesController, RatingsController, TagsController } from './social.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [AccessModule, CoursesModule, EnrolModule, GradesModule, SpaceRoutingModule],
  controllers: [TagsController, CommentsController, RatingsController, NotesController],
  providers: [
    {
      provide: SocialRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new SocialRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    TagsService, CommentsService, RatingsService, NotesService,
  ],
  exports: [TagsService, CommentsService, RatingsService, NotesService],
})
export class SocialModule {}
