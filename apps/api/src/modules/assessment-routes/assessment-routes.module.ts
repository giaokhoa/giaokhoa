import { Module } from '@nestjs/common';
import { ExamsModule } from '../exams/exams.module';
import { QuestionBanksController } from '../questions/question-banks.controller';
import { QuestionsModule } from '../questions/questions.module';
import { ExamMatricesController } from '../quiz/quiz.controller';
import { QuizModule } from '../quiz/quiz.module';

@Module({
  imports: [QuestionsModule, QuizModule, ExamsModule],
  controllers: [QuestionBanksController, ExamMatricesController],
})
export class AssessmentRoutesModule {}
