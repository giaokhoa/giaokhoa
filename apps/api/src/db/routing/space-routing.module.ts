import { Module } from '@nestjs/common';
import { ControlPlaneConnectionModule } from '../control-plane-connection.module';
import { SpaceDatabaseService } from './space-database.service';

/**
 * SpaceRoutingModule (issue #581): khung định tuyến kết nối theo trung tâm ở tầng dữ kiện. Import ControlPlaneConnectionModule để dùng chung kết nối control plane (nguồn đọc sổ đăng ký của bộ phân giải); xuất `SpaceDatabaseService` cho nhà cung cấp kết nối của API
 * (`app.module.ts` gắn handle kho chung và nhận handle định tuyến)
 * và cho các tầng gắn ngữ cảnh/trình nền ở các issue kế tiếp.
 */
@Module({
  // Chỉ phụ thuộc adapter kết nối; không phải import facade quản trị
  // ControlPlaneModule (có phụ thuộc AccessModule), nên không tạo vòng.
  imports: [ControlPlaneConnectionModule],
  providers: [SpaceDatabaseService],
  exports: [SpaceDatabaseService],
})
export class SpaceRoutingModule {}
