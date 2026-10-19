import { QuestionsService } from '@giaokhoa/application/questions/service';
import type { Question, QuestionCreate, QuestionPatch } from '@giaokhoa/shared/questions';
import { questionsContract } from '@giaokhoa/shared/http/questions';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  async create(
    @Body({ schema: questionsContract.create.body }) body: QuestionCreate,
    @Session() session: UserSession,
  ): Promise<Question> {
    return questionsContract.create.responses[201].parse(
      await this.questions.createQuestion(body, session.user.id),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: questionsContract.get.pathParams.shape.id }) id: string,
  ): Promise<Question> {
    return questionsContract.get.responses[200].parse(await this.questions.getQuestion(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: questionsContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: questionsContract.update.body }) body: QuestionPatch,
    @Session() session: UserSession,
  ): Promise<Question> {
    return questionsContract.update.responses[200].parse(
      await this.questions.updateQuestion(id, body, session.user.id),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id', { schema: questionsContract.delete.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ) {
    return this.questions.deleteQuestion(id, session.user.id);
  }
}
