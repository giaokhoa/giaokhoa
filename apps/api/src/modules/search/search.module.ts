import { Module } from '@nestjs/common';
import { SearchRepository } from '@giaokhoa/db/repositories/search';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { SearchController } from './search.controller';
import { PostgresSearchEngine, SEARCH_ENGINE, SearchService } from './search.service';

@Module({
  imports: [AccessModule, SpaceRoutingModule],
  controllers: [SearchController],
  providers: [
    {
      provide: SearchRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new SearchRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    SearchService, PostgresSearchEngine, { provide: SEARCH_ENGINE, useClass: PostgresSearchEngine },
  ],
  exports: [SearchService],
})
export class SearchModule {}
