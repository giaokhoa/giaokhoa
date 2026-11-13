import { useState } from 'react';

/**
 * Cờ "đang lưu" cho một nhóm thao tác trong trang tuỳ chọn thông báo (S18 của rà soát code style): mỗi nhóm giữ một tập khoá đang lưu dở (provider, nhóm, khoá học) để khoá đúng điều khiển trong lúc chờ API và tránh gửi trùng cùng một thao tác.
 *
 * Flow: `has(khoá)` kiểm tra trước khi gửi, `mark(khoá)` đánh dấu lúc bắt đầu, `unmark(khoá)` gỡ dấu khi xong (cả khi lỗi). Ba nhóm cờ của trang (tuỳ chọn theo loại, ghi theo nhóm, ngoại lệ theo khoá) là ba phiên bản riêng của hook này.
 */
export function useSavingKeys() {
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  return {
    /** Khoá có đang trong một lần lưu dở hay không. */
    has: (key: string) => saving.has(key),
    /** Đánh dấu khoá đang lưu (bỏ qua lần gửi trùng cùng khoá). */
    mark: (key: string) => setSaving((prev) => new Set(prev).add(key)),
    /** Gỡ dấu của khoá khi lần lưu xong (cả khi lỗi). */
    unmark: (key: string) =>
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
  };
}
