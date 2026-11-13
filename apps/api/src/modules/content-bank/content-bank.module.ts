import { Module } from '@nestjs/common';
import { ContentBankRepository } from '@giaokhoa/db/repositories/content-bank';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { FilesModule } from '../files/files.module';
import { SearchModule } from '../search/search.module';
import { ContentBankController } from './content-bank.controller';
import { ContentBankService } from './content-bank.service';

@Module({
  imports: [AccessModule, FilesModule, SearchModule, CoursesModule, SpaceRoutingModule],
  controllers: [ContentBankController],
  providers: [
    {
      provide: ContentBankRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new ContentBankRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    ContentBankService,
  ],
  exports: [ContentBankService],
})
export class ContentBankModule {}
