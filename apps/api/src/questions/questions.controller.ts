import { QuestionsService } from '@giaokhoa/application/questions/service';
import type {
  Question,
  QuestionCreate,
  QuestionPatch,
  QuestionVersionSummary,
} from '@giaokhoa/shared/questions';
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

  @Get()
  async list(@Session() session: UserSession): Promise<Question[]> {
    return questionsContract.list.responses[200].parse(
      await this.questions.listQuestions(session.user.id),
    );
  }

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
    @Session() session: UserSession,
  ): Promise<Question> {
    return questionsContract.get.responses[200].parse(
      await this.questions.getQuestion(id, session.user.id),
    );
  }

  @Get(':id/ready')
  async getReady(
    @Param('id', { schema: questionsContract.getReady.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<Question> {
    return questionsContract.getReady.responses[200].parse(
      await this.questions.getLatestReadyQuestion(id, session.user.id),
    );
  }

  @Get(':id/versions')
  async listVersions(
    @Param('id', { schema: questionsContract.listVersions.pathParams.shape.id }) id: string,
    @Session() session: UserSession,
  ): Promise<QuestionVersionSummary[]> {
    return questionsContract.listVersions.responses[200].parse(
      await this.questions.listQuestionVersions(id, session.user.id),
    );
  }

  @Get(':id/versions/:version')
  async getVersion(
    @Param('id', { schema: questionsContract.getVersion.pathParams.shape.id }) id: string,
    @Param('version', { schema: questionsContract.getVersion.pathParams.shape.version })
    version: number,
    @Session() session: UserSession,
  ): Promise<Question> {
    return questionsContract.getVersion.responses[200].parse(
      await this.questions.getQuestionVersion(id, version, session.user.id),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: questionsContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: questionsContract.update.body })
    body: QuestionPatch & { expectedVersion: number },
    @Session() session: UserSession,
  ): Promise<Question> {
    const { expectedVersion, ...patch } = body;
    return questionsContract.update.responses[200].parse(
      await this.questions.updateQuestion(id, patch, expectedVersion, session.user.id),
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
