import { Module } from '@nestjs/common';
import { ExamsModule } from '../exams/exams.module';
import { QuestionBanksController } from '../questions/question-banks.controller';
import { QuestionsModule } from '../questions/questions.module';
import { ExamMatricesController } from '../quiz/quiz.controller';
import { QuizModule } from '../quiz/quiz.module';

/**
 * Các controller HTTP điều phối nhiều miền ngân hàng và đề thi:
 * - QuestionBanksController dùng QuestionsService và MatrixBanksService.
 * - ExamMatricesController dùng QuizService, MatrixBanksService,
 *   MatrixImportService và ExamsService.
 *
 * Đặt bộ điều phối ở module HTTP phía ngoài, thay vì để QuestionsModule
 * import ngược QuizModule hoặc QuizModule import ngược ExamsModule.
 * Mỗi tiền tố route vẫn chỉ có MỘT controller sở hữu và giữ nguyên URL.
 */
@Module({
  imports: [QuestionsModule, QuizModule, ExamsModule],
  controllers: [QuestionBanksController, ExamMatricesController],
})
export class AssessmentRoutesModule {}
