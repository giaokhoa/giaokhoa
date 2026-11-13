import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';
import { BookService } from './books.service';
import {
  importBookDatasetSchema,
  type ImportBookDatasetDto,
} from './dto/books.dto';

@ApiTags('books')
@Controller({ path: 'books', version: '1' })
export class BooksController {
  constructor(private readonly booksService: BookService) {}

  @Get('dataset-import')
  async listDatasetImportStatus(@CurrentUser() actor: AuthenticatedUser) {
    return this.booksService.listDatasetStatus(actor.id);
  }
  @Post('dataset-import')
  async importDataset(@Body({ schema: importBookDatasetSchema }) dto: ImportBookDatasetDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.booksService.importDataset(actor.id, dto.datasetKey);
  }
  @Get()
  async listBooks(@Query('kind') kind: string | undefined, @Query('subjectId') subjectId: string | undefined, @Query('forCourseId') forCourseId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.booksService.listBooks(actor.id, subjectId, forCourseId, kind);
  }
  @Get(':id/tree')
  async getBookTree(@Param('id', { schema: uuidIdSchema }) id: string, @Query('forCourseId') forCourseId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.booksService.getBookTree(actor.id, id, forCourseId);
  }
  @Get(':id/questions')
  async getBookQuestions(@Param('id', { schema: uuidIdSchema }) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.booksService.listBookQuestions(actor.id, id);
  }
}
