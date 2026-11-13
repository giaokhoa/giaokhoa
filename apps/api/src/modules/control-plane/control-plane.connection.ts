/**
 * Điểm tương thích cho các đường kiểm thử/CLI đang dùng tên adapter cũ.
 * Instance và token DI thực sự thuộc tầng db; không tạo thêm pool.
 */
export { ControlPlaneConnection } from '../../db/control-plane-connection.service';
