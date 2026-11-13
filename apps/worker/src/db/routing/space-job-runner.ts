import { Injectable } from '@nestjs/common';
import { tenantAls } from '../tenant-als';
import { SpaceRoutingError } from './space-connection-resolver';
import { SpaceDatabaseService } from './space-database.service';

/**
 * Chạy job trên đúng kho đã chốt khi relay phát sự kiện.
 *
 * @remarks
 * Job của kho riêng mang cả slug lẫn id bất biến của dòng đăng ký.
 * Mỗi lần thử lại phân giải sổ hiện hành; slug thiếu, bị thu hồi hoặc
 * trỏ sang một id khác đều bị từ chối TRƯỚC khi chạy handler. Không
 * có đường dự phòng về platform khi thiếu control plane. Kho chung
 * chỉ nhận job không thuộc trung tâm hoặc slug đã được xác nhận shared.
 */
@Injectable()
export class SpaceJobRunner {
  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  /**
   * Kiểm chứng miền của job và mở phiên dữ liệu trước khi thực thi.
   *
   * @param data Phong bì đã đóng dấu miền khi vào hàng đợi.
   * @param fn Handler chỉ chạy sau khi miền đã được chấp nhận.
   * @returns Kết quả của handler trong kho đã xác thực.
   * @throws SpaceRoutingError Nếu thiếu, giả mạo hoặc thu hồi miền;
   *   lỗi đọc sổ và mở database được truyền nguyên để retry an toàn.
   */
  async runForJob<T>(
    data: { spaceSlug?: string | null; spaceId?: string | null; tenantId?: string | null },
    fn: () => Promise<T>,
  ): Promise<T> {
    const slug = data.spaceSlug;
    if (!slug) {
      // Tenant của job legacy kho chung chỉ được phép dùng platform
      // khi producer đóng dấu tường minh cả hai trường scope là null.
      // Thiếu trường (undefined) không được xem là một xác nhận shared.
      if (data.spaceSlug !== null || data.spaceId !== null) {
        throw new SpaceRoutingError('space_routing.job_scope_missing', 'Scoped job is missing its space slug');
      }
      return tenantAls.run({ platform: true }, async () => fn());
    }
    // Sổ đăng ký là nguồn sự thật cho MỌI lần retry, kể cả khi Redis
    // còn giữ một job từ trước lúc trung tâm bị xoá hay chuyển kho.
    const target = await this.spaceDb.resolveTarget(slug);
    if (target.status !== 'active') {
      throw new SpaceRoutingError('space_routing.job_space_inactive', `Space ${slug} is not active for background work`);
    }
    if (data.spaceId && data.spaceId !== target.spaceId) {
      throw new SpaceRoutingError('space_routing.job_identity_mismatch', `Space identity changed for ${slug}`);
    }
    if (target.mode === 'dedicated') {
      if (!data.spaceId) {
        throw new SpaceRoutingError('space_routing.job_identity_missing', `Dedicated job ${slug} is missing its registry identity`);
      }
      return this.spaceDb.withSpaceKysely(slug, async () => {
        // Tránh đua trạng thái: lần chuẩn bị handle bên trong phiên
        // có thể phân giải phiên bản sổ mới hơn bước kiểm ở trên.
        const prepared = await this.spaceDb.resolveTarget(slug);
        if (tenantAls.getStore()?.spaceId !== data.spaceId || prepared.spaceId !== data.spaceId
          || prepared.mode !== 'dedicated' || prepared.status !== 'active') {
          throw new SpaceRoutingError('space_routing.job_identity_mismatch', `Space identity changed for ${slug}`);
        }
        return fn();
      }, { tenantId: data.tenantId ?? undefined });
    }
    if (data.spaceId) {
      // Job đã đóng miền riêng không được chạy như job shared nếu
      // sổ đổi chế độ giữa lần phát và lần thực thi.
      throw new SpaceRoutingError('space_routing.job_storage_changed', `Space ${slug} no longer uses its original store`);
    }
    return tenantAls.run({ platform: true }, async () => fn());
  }
}
