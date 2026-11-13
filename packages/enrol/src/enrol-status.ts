/**
 * Trạng thái của dòng ghi danh `user_enrolments` — nguồn sự thật DUY NHẤT trong package cho ba trạng thái này (quyết định đã chốt, xem README của package: 0 = đang hiệu lực, 1 = tạm đình chỉ, 2 = đã rút nhưng giữ dòng vì còn dữ liệu liên quan). Mọi file trong package dùng các hằng này thay vì số thô hay định nghĩa riêng, để một trạng thái không bao giờ có hai tên. File leaf không import gì để mọi lõi đều import được mà không tạo vòng phụ thuộc module.
 */

/** Trạng thái ghi danh đang hiệu lực. */
export const ENROL_ACTIVE = 0;
/** Trạng thái ghi danh bị đình chỉ (không truy cập được khoá, gán vai vẫn còn). */
export const ENROL_SUSPENDED = 1;
/** Trạng thái ghi danh đã rút nhưng dòng được giữ vì user còn dữ liệu liên quan trong khoá. */
export const ENROL_WITHDRAWN = 2;
