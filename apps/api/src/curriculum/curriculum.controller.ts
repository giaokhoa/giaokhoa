import { CurriculumService } from '@giaokhoa/application/curriculum/service';
import type {
  Curriculum,
  CurriculumCreate,
  CurriculumNode,
  CurriculumNodeCreate,
  CurriculumNodePatch,
  CurriculumPatch,
  LearningOutcome,
  LearningOutcomeCreate,
  LearningOutcomePatch,
  Subject,
  SubjectCreate,
  SubjectPatch,
} from '@giaokhoa/shared/curriculum';
import { curriculaContract } from '@giaokhoa/shared/http/curricula';
import { curriculumNodesContract } from '@giaokhoa/shared/http/curriculum-nodes';
import { learningOutcomesContract } from '@giaokhoa/shared/http/learning-outcomes';
import { subjectsContract } from '@giaokhoa/shared/http/subjects';
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
import { Roles } from '@thallesp/nestjs-better-auth';

@Roles(['admin'])
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get()
  async list(): Promise<Subject[]> {
    return subjectsContract.list.responses[200].parse(await this.curriculum.listSubjects());
  }

  @Post()
  async create(
    @Body({ schema: subjectsContract.create.body }) body: SubjectCreate,
  ): Promise<Subject> {
    return subjectsContract.create.responses[201].parse(await this.curriculum.createSubject(body));
  }

  @Get(':id')
  async get(
    @Param('id', { schema: subjectsContract.get.pathParams.shape.id }) id: string,
  ): Promise<Subject> {
    return subjectsContract.get.responses[200].parse(await this.curriculum.getSubject(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: subjectsContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: subjectsContract.update.body }) body: SubjectPatch,
  ): Promise<Subject> {
    return subjectsContract.update.responses[200].parse(
      await this.curriculum.updateSubject(id, body),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', { schema: subjectsContract.delete.pathParams.shape.id }) id: string) {
    return this.curriculum.deleteSubject(id);
  }

  @Get(':id/curricula')
  async listCurricula(
    @Param('id', { schema: subjectsContract.listCurricula.pathParams.shape.id }) id: string,
  ): Promise<Curriculum[]> {
    return subjectsContract.listCurricula.responses[200].parse(
      await this.curriculum.listCurricula(id),
    );
  }

  @Get(':id/curricula/:grade')
  async getCurriculum(
    @Param('id', { schema: subjectsContract.getCurriculumByGrade.pathParams.shape.id })
    id: string,
    @Param('grade', {
      schema: subjectsContract.getCurriculumByGrade.pathParams.shape.grade,
    })
    grade: number,
  ): Promise<Curriculum> {
    return subjectsContract.getCurriculumByGrade.responses[200].parse(
      await this.curriculum.getCurriculumBySubjectAndGrade(id, grade),
    );
  }
}

@Roles(['admin'])
@Controller('curricula')
export class CurriculaController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get()
  async list(): Promise<Curriculum[]> {
    return curriculaContract.list.responses[200].parse(await this.curriculum.listAllCurricula());
  }

  @Post()
  async create(
    @Body({ schema: curriculaContract.create.body }) body: CurriculumCreate,
  ): Promise<Curriculum> {
    return curriculaContract.create.responses[201].parse(
      await this.curriculum.createCurriculum(body),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: curriculaContract.get.pathParams.shape.id }) id: string,
  ): Promise<Curriculum> {
    return curriculaContract.get.responses[200].parse(await this.curriculum.getCurriculum(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: curriculaContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: curriculaContract.update.body }) body: CurriculumPatch,
  ): Promise<Curriculum> {
    return curriculaContract.update.responses[200].parse(
      await this.curriculum.updateCurriculum(id, body),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', { schema: curriculaContract.delete.pathParams.shape.id }) id: string) {
    return this.curriculum.deleteCurriculum(id);
  }

  @Get(':id/nodes')
  async listNodes(
    @Param('id', { schema: curriculaContract.listNodes.pathParams.shape.id }) id: string,
  ): Promise<CurriculumNode[]> {
    return curriculaContract.listNodes.responses[200].parse(await this.curriculum.listNodes(id));
  }
}

@Roles(['admin'])
@Controller('curriculum-nodes')
export class CurriculumNodesController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Post()
  async create(
    @Body({ schema: curriculumNodesContract.create.body }) body: CurriculumNodeCreate,
  ): Promise<CurriculumNode> {
    return curriculumNodesContract.create.responses[201].parse(
      await this.curriculum.createNode(body),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: curriculumNodesContract.get.pathParams.shape.id }) id: string,
  ): Promise<CurriculumNode> {
    return curriculumNodesContract.get.responses[200].parse(await this.curriculum.getNode(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: curriculumNodesContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: curriculumNodesContract.update.body }) body: CurriculumNodePatch,
  ): Promise<CurriculumNode> {
    return curriculumNodesContract.update.responses[200].parse(
      await this.curriculum.updateNode(id, body),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', { schema: curriculumNodesContract.delete.pathParams.shape.id }) id: string) {
    return this.curriculum.deleteNode(id);
  }

  @Get(':id/outcomes')
  async listOutcomes(
    @Param('id', { schema: curriculumNodesContract.listOutcomes.pathParams.shape.id })
    id: string,
  ): Promise<LearningOutcome[]> {
    return curriculumNodesContract.listOutcomes.responses[200].parse(
      await this.curriculum.listOutcomes(id),
    );
  }
}

@Roles(['admin'])
@Controller('learning-outcomes')
export class LearningOutcomesController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Post()
  async create(
    @Body({ schema: learningOutcomesContract.create.body }) body: LearningOutcomeCreate,
  ): Promise<LearningOutcome> {
    return learningOutcomesContract.create.responses[201].parse(
      await this.curriculum.createOutcome(body),
    );
  }

  @Get(':id')
  async get(
    @Param('id', { schema: learningOutcomesContract.get.pathParams.shape.id }) id: string,
  ): Promise<LearningOutcome> {
    return learningOutcomesContract.get.responses[200].parse(await this.curriculum.getOutcome(id));
  }

  @Patch(':id')
  async update(
    @Param('id', { schema: learningOutcomesContract.update.pathParams.shape.id }) id: string,
    @Body({ schema: learningOutcomesContract.update.body }) body: LearningOutcomePatch,
  ): Promise<LearningOutcome> {
    return learningOutcomesContract.update.responses[200].parse(
      await this.curriculum.updateOutcome(id, body),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', { schema: learningOutcomesContract.delete.pathParams.shape.id }) id: string) {
    return this.curriculum.deleteOutcome(id);
  }
}
