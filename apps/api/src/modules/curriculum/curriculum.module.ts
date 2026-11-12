import { Module } from '@nestjs/common';
import { CurriculumRepository } from '@giaokhoa/db/repositories/curriculum';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';
import { ProgramDumpService } from './program-dump.service';
import { ProgramImportService } from './program-import.service';

/**
 * Module chương trình GDPT 2018: dùng Access để kiểm tra quyền và Courses để gắn chương trình với khoá học; nghiệp vụ sách giáo khoa do BooksModule đảm nhiệm.
 *
 * `CurriculumRepository` được dựng từ handle Kysely `routedKysely` thay vì một kết nối cố định: mọi truy vấn phải vào đúng kho trung tâm của ngữ cảnh tenant và tuân thủ GUC/RLS.
 */
@Module({
  imports: [AccessModule, CoursesModule, SpaceRoutingModule],
  controllers: [CurriculumController],
  providers: [
    {
      provide: CurriculumRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new CurriculumRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CurriculumService, ProgramImportService, ProgramDumpService,
  ],
  exports: [CurriculumService, CurriculumRepository, ProgramImportService, ProgramDumpService],
})
/** Module chương trình học: subjects, curricula, cây nodes, learning outcomes. */
export class CurriculumModule {}
