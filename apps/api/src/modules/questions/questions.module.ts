import { forwardRef, Module } from '@nestjs/common';
import { QuestionBanksRepository } from '@giaokhoa/db/repositories/question-banks';
import { QuestionsRepository } from '@giaokhoa/db/repositories/questions';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { EventsModule } from '../../infra/events/events.module';
import { AccessModule } from '../access/access.module';
import { FilesModule } from '../files/files.module';
import { GroupsModule } from '../groups/groups.module';
import { QuizModule } from '../quiz/quiz.module';
import { TenantsModule } from '../tenants/tenants.module';
import { QuestionBanksController } from './question-banks.controller';
import { QuestionBanksService } from './question-banks.service';
import { QuestionsController, QuestionUsagesController, StimuliController } from './questions.controller';
import { QuestionsService } from './questions.service';

/**
 * Module câu hỏi và ngân hàng câu hỏi: cung cấp QuestionsService và QuestionBanksService, kiểm tra quyền qua Access và lấy thành viên nhóm qua Groups.
 *
 * Vòng phụ thuộc Questions ↔ Quiz là bắt buộc vì controller `question-banks` ở module này uỷ quyền bề mặt ma trận cho QuizModule, trong khi QuizModule sử dụng facade câu hỏi. Hai phía dùng `forwardRef` để Nest giải vòng phụ thuộc.
 *
 * Cả QuestionsRepository và QuestionBanksRepository nhận `routedKysely` từ SpaceDatabaseService qua factory provider, nên các thao tác đọc/ghi vào đúng kho của ngữ cảnh request. Luồng `buildBank` sử dụng transaction Kysely để cập nhật ngân hàng và danh mục nhất quán.
 */
@Module({
  imports: [AccessModule, EventsModule, GroupsModule, TenantsModule, FilesModule, SpaceRoutingModule, forwardRef(() => QuizModule)],
  controllers: [QuestionsController, QuestionUsagesController, StimuliController, QuestionBanksController],
  providers: [
    {
      provide: QuestionsRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new QuestionsRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: QuestionBanksRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new QuestionBanksRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    QuestionsService, QuestionBanksService,
  ],
  exports: [QuestionsService, QuestionBanksService],
})
/** Module ngân hàng câu hỏi và question engine. */
export class QuestionsModule {}
