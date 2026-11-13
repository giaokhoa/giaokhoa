import { replace } from 'react-router';

/**
 * Tạo HTTP redirect giữ query cho ba URL cũ của lượt làm bài:
 * `/courses/:id/quizzes/:quizId[/results|/paper]` chuyển sang
 * `/courses/:id/exams/:quizId[...]`. `replace()` giữ hành vi thay thế
 * lịch sử phía client như `<Navigate replace />` trước đây, đồng thời
 * trả 302 từ server ngay khi tải thẳng URL cũ.
 *
 * @param request - Request gốc, chứa URL và query cần bảo toàn.
 * @returns Response redirect 302 tới URL chuẩn.
 */
export function legacyQuizLoader(request: Request): Response {
  const url = new URL(request.url);
  const next = url.pathname.replace('/quizzes/', '/exams/');
  return replace(`${next}${url.search}`);
}

/** Route module dùng chung component rỗng; loader của từng route tương thích luôn chuyển hướng trước render. */
export default function LegacyQuizRedirect() {
  return null;
}
