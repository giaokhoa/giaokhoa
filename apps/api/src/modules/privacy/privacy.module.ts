import { Module } from '@nestjs/common';
import { PrivacyRepository } from '@giaokhoa/db/repositories/privacy';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { AccessModule } from '../access/access.module';
import { FilesModule } from '../files/files.module';
import { UsersModule } from '../users/users.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AccessModule, FilesModule, UsersModule, SpaceRoutingModule],
  controllers: [PrivacyController],
  providers: [
    {
      provide: PrivacyRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new PrivacyRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    PrivacyService,
  ],
  exports: [PrivacyService],
})
export class PrivacyModule {}
