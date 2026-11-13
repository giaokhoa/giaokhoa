import { Module, ServiceUnavailableException } from '@nestjs/common';
import { SystemBankCentreRepository } from '@giaokhoa/db/repositories/system-bank-centre';
import { SystemBankRepository } from '@giaokhoa/db/repositories/system-bank';
import { SystemBankSubmissionsRepository } from '@giaokhoa/db/repositories/system-bank-submissions';
import { SpaceDatabaseService } from '../../db/routing/space-database.service';
import { SpaceRoutingModule } from '../../db/routing/space-routing.module';
import { FilesModule } from '../files/files.module';
import { AccessModule } from '../access/access.module';
import { QuestionsModule } from '../questions/questions.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SystemBankConnection } from './system-bank.connection';
import { SystemBankController } from './system-bank.controller';
import { SystemBankDiscoveryController } from './system-bank-discovery.controller';
import { SystemBankPackagesController } from './system-bank-packages.controller';
import { SystemBankService } from './system-bank.service';
import { SystemBankSubmissionsService } from './system-bank-submissions.service';
import { SystemBankSubmissionsController } from './system-bank-submissions.controller';
import { SystemBankMediaService } from './system-bank-media.service';
import { SystemMaterialsRepository } from '@giaokhoa/db/repositories/system-materials';
import { SystemMaterialReferencesRepository } from '@giaokhoa/db/repositories/system-material-references';
import { ContentBankModule } from '../content-bank/content-bank.module';
import { CoursesModule } from '../courses/courses.module';
import { SystemMaterialsService } from './system-materials.service';
import { SystemMaterialsController } from './system-materials.controller';

@Module({
  imports: [AccessModule, QuestionsModule, TenantsModule, SpaceRoutingModule, FilesModule, ContentBankModule, CoursesModule],
  controllers: [SystemBankController, SystemBankDiscoveryController, SystemBankPackagesController, SystemBankSubmissionsController, SystemMaterialsController],
  providers: [
    SystemBankConnection,
    {
      provide: SystemMaterialsRepository,
      useFactory: (connection: SystemBankConnection) => new SystemMaterialsRepository(connection.kysely, () =>
        new ServiceUnavailableException({ message: 'System bank is not configured', code: 'system_bank.not_configured' })),
      inject: [SystemBankConnection],
    },
    {
      provide: SystemMaterialReferencesRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new SystemMaterialReferencesRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    SystemMaterialsService,
    {
      provide: SystemBankRepository,
      useFactory: (connection: SystemBankConnection) =>
        new SystemBankRepository(connection.kysely, () =>
          new ServiceUnavailableException({
            message: 'System bank is not configured (SYSTEM_BANK_DATABASE_URL is not set)',
            code: 'system_bank.not_configured',
          }),
        ),
      inject: [SystemBankConnection],
    },
    {
      provide: SystemBankCentreRepository,
      useFactory: (spaceDb: SpaceDatabaseService) => new SystemBankCentreRepository(spaceDb.routedKysely),
      inject: [SpaceDatabaseService],
    },
    {
      provide: SystemBankSubmissionsRepository,
      useFactory: (connection: SystemBankConnection) =>
        new SystemBankSubmissionsRepository(connection.kysely, () =>
          new ServiceUnavailableException({ message: 'System bank is not configured', code: 'system_bank.not_configured' }),
        ),
      inject: [SystemBankConnection],
    },
    SystemBankMediaService,
    SystemBankSubmissionsService,
    SystemBankService,
  ],
  exports: [SystemBankService, SystemBankConnection, SystemBankMediaService, SystemMaterialsService],

})
export class SystemBankModule {}
