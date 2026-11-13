import { Module } from '@nestjs/common';
import { CustomFieldsRepository } from '@giaokhoa/db/repositories/custom-fields';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

@Module({
  imports: [SpaceRoutingModule],
  controllers: [CustomFieldsController],
  providers: [
    {
      provide: CustomFieldsRepository,
      useFactory: (spaceDatabase: SpaceDatabaseService) => new CustomFieldsRepository(spaceDatabase.routedKysely),
      inject: [SpaceDatabaseService],
    },
    CustomFieldsService,
  ],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
