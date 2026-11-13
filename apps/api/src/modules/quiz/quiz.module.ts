import { Module } from '@nestjs/common';
import { QuizRepository } from '@giaokhoa/db/repositories/quiz';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { EnrolModule } from '../enrol/enrol.module';
import { FilesModule } from '../files/files.module';
import { GradesModule } from '../grades/grades.module';
import { GroupsModule } from '../groups/groups.module';
import { QuestionsModule } from '../questions/questions.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { QuizAttemptsController } from './quiz.controller';
import { MatrixBanksService } from './matrix-banks.service';
import { MatrixImportService } from './matrix-import.service';
import { SystemBankModule } from '../system-bank/system-bank.module';
import { ExamQuestionSnapshotsService } from './exam-question-snapshots.service';
import { QuizService } from './quiz.service';

@Module({
  imports: [SystemBankModule, AccessModule, CoursesModule, QuestionsModule, GradesModule, UsersModule, GroupsModule, CurriculumModule, EventsModule, TenantsModule, EnrolModule, FilesModule, SpaceRoutingModule],
  controllers: [QuizAttemptsController],
  providers: [
    { provide: QuizRepository, useFactory: (spaceDb: SpaceDatabaseService) => new QuizRepository(spaceDb.routedKysely), inject: [SpaceDatabaseService] },
    QuizService, ExamQuestionSnapshotsService, MatrixBanksService, MatrixImportService,
  ],
  exports: [ExamQuestionSnapshotsService, QuizService, MatrixBanksService, MatrixImportService],
})
export class QuizModule {}
