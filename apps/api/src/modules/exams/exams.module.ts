import { Module } from '@nestjs/common';
import { ExamsRepository } from '@giaokhoa/db/repositories/exams';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { QuestionsModule } from '../questions/questions.module';
import { QuizModule } from '../quiz/quiz.module';
import { SiteConfigModule } from '../site-config/site-config.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ExamDossiersService } from './exam-dossiers.service';
import { ExamsController } from './exams.controller';
import { ExamPapersAliasController } from './exam-papers-alias.controller';
import { CourseExamPinsController, ExamPinFeedbacksController, ExamPinOverridesController, ExamPinsController } from './exam-pins.controller';
import { ExamsService } from './exams.service';

/**
 * ExamsModule facade (feat issue #113, EB-1): lớp Ngân hàng đề — thực thể đề snapshot + version + slots ghim trên khuôn bank đa loại của Questions (bank + capability exam:* tại context bank), triển khai vào quiz qua facade của Quiz (deployPaperSlots). EB-3 (#165) thêm luồng duyệt BỘ HỒ SƠ (ExamDossiersService — đọc seam cấu hình cấp duyệt 2 qua SiteConfigModule) và lớp bảo mật xem đề định kỳ trong chính ExamsService.
 *
 * Controller `exam-matrices` được đặt ở AssessmentRoutesModule,
 * cho phép ExamsModule chỉ phụ thuộc một chiều vào QuestionsModule và
 * QuizModule; không cần `forwardRef` giữa ba module nghiệp vụ.
 */
@Module({
  imports: [AccessModule, EventsModule, QuestionsModule, QuizModule, SiteConfigModule, TenantsModule, SpaceRoutingModule],
  controllers: [ExamsController, ExamPapersAliasController, CourseExamPinsController, ExamPinsController, ExamPinOverridesController, ExamPinFeedbacksController],
  providers: [
    // ExamsRepository nhận handle định tuyến theo không gian để GUC/RLS và kho dữ liệu khớp với ngữ cảnh của request.
    { provide: ExamsRepository, useFactory: (spaceDb: SpaceDatabaseService) => new ExamsRepository(spaceDb.routedKysely), inject: [SpaceDatabaseService] },
    ExamsService, ExamDossiersService,
  ],
  exports: [ExamsService],
})
/** Module ngân hàng đề (đề snapshot/version/slots + triển khai vào quiz + duyệt bộ hồ sơ). */
export class ExamsModule {}
