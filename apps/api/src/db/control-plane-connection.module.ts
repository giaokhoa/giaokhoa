import { Module } from '@nestjs/common';
import { ControlPlaneConnection } from './control-plane-connection.service';

@Module({
  providers: [ControlPlaneConnection],
  exports: [ControlPlaneConnection],
})
export class ControlPlaneConnectionModule {}
