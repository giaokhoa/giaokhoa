/** Lời gọi HTTP thuần cho gửi/duyệt/khám phá và ghim phiên bản học liệu vào khoá. */
import type { SystemMaterialSubmission, SystemMaterialVersion, UseSystemMaterial } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import type { LibraryItem } from '../types/content-bank';

const ROOT = '/api/v1/system-bank/materials';

/** Danh sách nguồn do API lọc theo quyền quản trị và trung tâm hiện tại. */
export const materialSources = () => apiJson<LibraryItem[]>(`${ROOT}/submissions/sources`);
/** Lịch sử trung tâm hoặc hàng chờ biên tập. */
export const materialSubmissions = (scope: 'mine' | 'pending') => apiJson<SystemMaterialSubmission[]>(`${ROOT}/submissions/${scope}`);
/** Từng phiên bản công bố, cho giáo viên chọn rõ số phiên bản. */
export const publishedMaterials = () => apiJson<SystemMaterialVersion[]>(ROOT);
/** Gửi bản chụp; không sửa trạng thái học liệu nguồn. */
export const submitMaterial = (contentId: string) => apiJson<SystemMaterialSubmission>(`${ROOT}/submissions`, { method: 'POST', body: JSON.stringify({ contentId }) });
/** Quyết định hệ thống, lý do từ chối do schema server kiểm lại. */
export const reviewMaterial = (id: string, reason?: string) => apiJson<SystemMaterialSubmission>(`${ROOT}/submissions/${id}/${reason ? 'reject' : 'approve'}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) });
/** Ghim bản nguyên trạng, không nhập thành học liệu riêng có thể sửa. */
export const attachPublishedMaterial = (input: UseSystemMaterial) => apiJson<{ cmId: string; resourceId: string }>(`${ROOT}/use`, { method: 'POST', body: JSON.stringify(input) });
