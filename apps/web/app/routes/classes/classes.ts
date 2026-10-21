export function normalizeClassDates(value: unknown, fields: readonly string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const field of fields) {
    const date = result[field];
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(date)) {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === date) result[field] = parsed;
    }
  }
  return result;
}

export function getClassErrorStatus(status: number) {
  return status >= 400 && status <= 599 ? status : 502;
}

export function getClassAccess(user: { id: string }, createdByUserId?: string) {
  const role = 'role' in user ? user.role : undefined;
  const banned = 'banned' in user && user.banned === true;
  const canCreate = !banned && (role === 'teacher' || role === 'admin');
  return {
    canCreate,
    canJoin: !banned && (role === 'user' || role === 'teacher' || role === 'admin'),
    isOwner: user.id === createdByUserId,
    canManage: canCreate && user.id === createdByUserId,
  };
}

export const classFieldMessages: Record<string, string> = {
  name: 'Tên lớp phải có từ 1 đến 200 ký tự.',
  joinMode: 'Vui lòng chọn cách gia nhập lớp.',
  status: 'Vui lòng chọn trạng thái lớp hợp lệ.',
  code: 'Mã gia nhập phải có từ 16 đến 256 ký tự.',
  id: 'ID lớp phải là UUID phiên bản 7 hợp lệ.',
  userId: 'ID thành viên không hợp lệ.',
  expiresInHours: 'Thời hạn phải là số giờ nguyên từ 1 đến 720.',
  maxUses: 'Số lượt dùng phải là số nguyên dương hoặc để trống.',
};

export function getClassFieldErrors(issues: readonly { path: readonly PropertyKey[] }[]) {
  return Object.fromEntries(
    issues.map((issue) => {
      const field = String(issue.path[0] ?? 'form');
      return [field, classFieldMessages[field] ?? 'Dữ liệu không hợp lệ.'];
    }),
  );
}

export function canChangeClassMember(
  intent: 'approve' | 'suspend',
  classStatus: 'active' | 'archived',
  memberStatus: 'pending' | 'active' | 'suspended' | 'left',
) {
  return intent === 'approve'
    ? classStatus === 'active' && memberStatus === 'pending'
    : memberStatus === 'pending' || memberStatus === 'active';
}

export function formatClassDate(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Không xác định'
    : new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(date);
}
