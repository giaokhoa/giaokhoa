const dateKeys = new Set([
  'createdAt',
  'updatedAt',
  'joinedAt',
  'expiresAt',
  'openAt',
  'closeAt',
  'releaseScoreAt',
  'releaseFeedbackAt',
  'releaseSolutionsAt',
  'publishedAt',
  'assignedAt',
  'revokedAt',
  'startedAt',
  'submittedAt',
  'gradedAt',
]);

/** Chuẩn hóa các trường thời gian HTTP trước khi kiểm tra hợp đồng, giữ nguyên văn bản trong nội dung câu hỏi. */
export function reviveApiDates(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, item) =>
    dateKeys.has(key) && typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item)
      ? new Date(item)
      : item,
  );
}

export function formatDate(value: Date | string | null) {
  return value
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : 'Chưa công bố';
}

/** Biểu mẫu dùng giờ Việt Nam cố định để không phụ thuộc múi giờ của máy chủ kết xuất. */
export function toLocalDateTime(value: Date | string | null) {
  return value ? new Date(new Date(value).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : '';
}

export function toInstant(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isFinite(date.getTime()) && toLocalDateTime(date) === value
    ? date.toISOString()
    : null;
}
