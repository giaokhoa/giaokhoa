import { Module } from '@nestjs/common';
import { GradesRepository } from '@giaokhoa/db/repositories/grades';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CompletionModule } from '../completion/completion.module';
import { CoursesModule } from '../courses/courses.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { EnrolModule } from '../enrol/enrol.module';
import { UsersModule } from '../users/users.module';
import { GradeItemsController, GradeRecordsController } from './grade-items.controller';
import { CourseGradeExportsController, CourseGradeItemsController, CourseGradebookController } from './grades.controller';
import { LegacyGradesCourseController, LegacyGradesPhantomController } from './legacy-grades.controller';
import { GradesService } from './grades.service';

/**
 * Module điểm theo bài: cung cấp GradesService, dùng Courses/Enrol/Access/Completion để kiểm tra ngữ cảnh và quyền, đồng thời đăng ký evaluator cho các luồng đánh giá.
 *
 * GradesRepository nhận handle Kysely định tuyến `routedKysely`. Các luồng `setGrade`, `recordActivityGrade` và `updateGrade` ghi điểm, lịch sử và outbox trong cùng transaction để không công bố sự kiện trước khi dữ liệu được commit.
 */
@Module({
  imports: [
    AccessModule, CoursesModule, EnrolModule, CompletionModule, EventsModule, UsersModule, CurriculumModule, SpaceRoutingModule,
  ],
  controllers: [CourseGradeItemsController, CourseGradebookController, CourseGradeExportsController, GradeItemsController, GradeRecordsController, LegacyGradesCourseController, LegacyGradesPhantomController],
  providers: [
    {
      provide: GradesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new GradesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    GradesService,
  ],
  exports: [GradesService],
})
/** Module điểm theo bài. */
export class GradesModule {}
