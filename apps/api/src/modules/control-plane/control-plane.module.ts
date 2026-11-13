import { Module, ServiceUnavailableException } from '@nestjs/common';
import { ControlPlaneRepository } from '@giaokhoa/db/repositories/control-plane';
import { AccessModule } from '../access/access.module';
import { ControlPlaneConnection } from '../../db/control-plane-connection.service';
import { ControlPlaneConnectionModule } from '../../db/control-plane-connection.module';
import { ControlPlaneController } from './control-plane.controller';
import { ControlPlaneRegistryService } from './control-plane.service';

@Module({
  imports: [AccessModule, ControlPlaneConnectionModule],
  controllers: [ControlPlaneController],
  providers: [
    {
      provide: ControlPlaneRepository,
      useFactory: (connection: ControlPlaneConnection) =>
        new ControlPlaneRepository(connection.kysely, () =>
          new ServiceUnavailableException({
            message: 'Control plane database is not configured',
            code: 'control_plane.not_configured',
          }),
        ),
      inject: [ControlPlaneConnection],
    },
    ControlPlaneRegistryService,
  ],
  exports: [ControlPlaneRegistryService, ControlPlaneConnectionModule, ControlPlaneRepository],
})
export class ControlPlaneModule {}
