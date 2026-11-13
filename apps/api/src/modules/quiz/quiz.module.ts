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

/**
 * QuizModule facade: QuizService (hoạt động mod_quiz trên question engine). Phụ thuộc facade của Courses (course module + context), Questions (bank + engine), Grades (grade item + ghi điểm của hoạt động), Users (tên hiển thị học sinh cho thống kê câu sai) và Access
 * (PermissionEvaluator/Contexts).
 *
 * Controller đa miền `exam-matrices` sống ở AssessmentRoutesModule
 * (tầng HTTP), vì cần ExamsService của module ngân hàng đề. QuizModule
 * chỉ import QuestionsModule theo chiều nghiệp vụ, không nhập ngược
 * ExamsModule hoặc tạo vòng phụ thuộc với QuestionsModule.
 *
  * QuizService đã tách cấu trúc bên trong theo 4 cụm ca sử dụng của issue #295 (ghim đề / ma trận / sinh đề-đặc tả / lượt làm-chấm-kết quả) cộng tầng thấp dùng chung, giữ nguyên bề mặt công khai và wiring của module — xem docblock của facade QuizService.
 */
@Module({
  imports: [SystemBankModule, AccessModule, CoursesModule, QuestionsModule, GradesModule, UsersModule, GroupsModule, CurriculumModule, EventsModule, TenantsModule, EnrolModule, FilesModule, SpaceRoutingModule],
  controllers: [QuizAttemptsController],
  providers: [
    // QuizRepository nhận handle định tuyến theo không gian để GUC/RLS và kho dữ liệu khớp với ngữ cảnh của request.
    { provide: QuizRepository, useFactory: (spaceDb: SpaceDatabaseService) => new QuizRepository(spaceDb.routedKysely), inject: [SpaceDatabaseService] },
    QuizService, ExamQuestionSnapshotsService, MatrixBanksService, MatrixImportService,
  ],
  exports: [ExamQuestionSnapshotsService, QuizService, MatrixBanksService, MatrixImportService],
})
/** Module hoạt động Quiz (đề thi trong khoá học). */
export class QuizModule {}
