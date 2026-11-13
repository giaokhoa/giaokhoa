import { Module } from '@nestjs/common';
import { BookRepository } from '@giaokhoa/db/repositories/books';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { BooksController } from './books.controller';
import { BookService } from './books.service';

@Module({
  imports: [AccessModule, CoursesModule, CurriculumModule, SpaceRoutingModule],
  controllers: [BooksController],
  providers: [
    {
      provide: BookRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new BookRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    BookService,
  ],
  exports: [BookService],
})
export class BooksModule {}
