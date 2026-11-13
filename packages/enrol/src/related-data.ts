import type { EnrolDatabase } from './types';

/**
 * Truy vấn DỮ LIỆU LIÊN QUAN của một người dùng trong một khoá học ở tầng dữ liệu dùng chung — căn cứ quyết định việc gỡ ghi danh giữ dòng `user_enrolments` dạng WITHDRAWN (giữ dữ liệu đóng góp) hay xoá cứng dòng (không còn dữ liệu nào để giữ), đúng sự phân chia của Moodle giữa dữ liệu tham gia hiển thị (được giữ) và tham gia vô hình (bị dọn).
 *
 * Trước đây dữ kiện này tới từ các probe do module nghiệp vụ của API đăng ký vào lúc khởi tạo (CompletionModule báo dữ liệu hoàn thành, GradesModule báo dữ liệu điểm) — cơ chế đăng ký lúc chạy đó chỉ tồn tại trong tiến trình API nên bề mặt vật chất hoá dùng chung không mang theo được. Hai kiểm ở đây là đúng hai truy vấn tồn tại thuần dữ liệu mà hai probe đó thực hiện, viết lại trên schema dùng chung: còn BẤT KỲ dòng dữ liệu nào thuộc hai họ này thì coi là còn dữ liệu liên quan.
 */

/**
 * Kiểm tồn tại một dòng qua một truy vấn đã dựng sẵn phần select/join/where: giới hạn một dòng rồi trả lời có/không. Hai kiểm dữ liệu liên quan cùng khuôn này nên dùng chung helper — mỗi hàm chỉ dựng phần select/join/where của mình, helper giữ bất biến "một truy vấn duy nhất, tối đa một dòng" (chỉ cần biết có hay không, không bao giờ tải toàn bộ danh sách id).
 *
 * @param query - truy vấn kiểm tồn tại đã dựng xong phần select/join/where (chưa giới hạn).
 */
async function existsOneRow(
  query: { limit(limit: number): { executeTakeFirst(): Promise<unknown> } },
): Promise<boolean> {
  return (await query.limit(1).executeTakeFirst()) !== undefined;
}

/**
 * Người dùng còn dữ liệu HOÀN THÀNH trong khoá học hay không: tồn
 * tại ít nhất một dòng `course_modules_completion` của người dùng
 * trên bất kỳ module chưa bị xoá của khoá (mọi dòng đều tính, kể cả
 * dòng chỉ-ghi-nhận-đã-xem — không lọc theo trạng thái hoàn thành,
 * đúng ngữ nghĩa probe hiện hành). Một truy vấn duy nhất nối bảng
 * hoàn thành với bảng module của khoá rồi giới hạn một dòng.
 *
 * @param db - tay cầm Kysely của host.
 * @param courseId - khoá học cần kiểm.
 * @param userId - người dùng cần kiểm.
 */
export async function hasCourseCompletionData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  return existsOneRow(
    db
      .selectFrom('course_modules_completion')
      .select('course_modules_completion.id')
      .innerJoin('course_modules', 'course_modules.id', 'course_modules_completion.course_module_id')
      .where((eb) => eb.and([
        eb('course_modules_completion.user_id', '=', userId),
        eb('course_modules.course', '=', courseId),
        eb('course_modules.deletion_in_progress', '=', false),
      ])),
  );
}

/**
 * Người dùng còn dữ liệu ĐIỂM trong khoá học hay không: tồn
 * tại ít nhất một dòng `grade_grades` của người dùng trên bất kỳ mục điểm
 * nào của khoá. Một truy vấn duy nhất nối bảng điểm với bảng mục điểm
 * của khoá rồi giới hạn một dòng.
 *
 * @param db - tay cầm Kysely của host.
 * @param courseId - khoá học cần kiểm.
 * @param userId - người dùng cần kiểm.
 */
export async function hasCourseGradeData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  return existsOneRow(
    db
      .selectFrom('grade_grades')
      .select('grade_grades.id')
      .innerJoin('grade_items', 'grade_items.id', 'grade_grades.item_id')
      .where((eb) => eb.and([
        eb('grade_grades.user_id', '=', userId),
        eb('grade_items.course_id', '=', courseId),
      ])),
  );
}

/**
 * Người dùng còn dữ liệu liên quan (hoàn thành hoặc điểm) trong
 * khoá học hay không — hợp của hai kiểm trên, đúng ngữ nghĩa vòng
 * lặp probe hiện hành (bất kỳ probe nào báo có là có).
 *
 * @param db - tay cầm Kysely của host.
 * @param courseId - khoá học cần kiểm.
 * @param userId - người dùng cần kiểm.
 */
export async function hasRelatedCourseData(db: EnrolDatabase, courseId: string, userId: string): Promise<boolean> {
  if (await hasCourseCompletionData(db, courseId, userId)) return true;
  return hasCourseGradeData(db, courseId, userId);
}
