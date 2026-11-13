import { Module } from '@nestjs/common';
import { ControlPlaneConnection } from './control-plane-connection.service';

/**
 * Điểm sở hữu duy nhất của kết nối control plane trong Nest DI.
 * Cả bộ định tuyến không gian lẫn facade nghiệp vụ sử dụng cùng provider,
 * nên một pool được đóng một lần qua OnModuleDestroy của adapter.
 */
@Module({
  providers: [ControlPlaneConnection],
  exports: [ControlPlaneConnection],
})
export class ControlPlaneConnectionModule {}
