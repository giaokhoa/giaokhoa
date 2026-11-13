/**
 * Tầng dữ liệu chương trình (GDPT 2018 + SGK + quản trị) — tách thành
 * ba module theo tầng để file đơn không phình (S30): `curriculum-core`
 * (kiểu dùng chung + chương trình GDPT), `curriculum-books` (SGK) và
 * `curriculum-admin` (trang quản trị + đột biến CRUD). Module này chỉ
 * tái xuất để mọi nơi vẫn nhập từ `#lib/curriculum` như trước, không
 * đổi đường nhập.
 */
export * from './curriculum-core';
export * from './curriculum-books';
export * from './curriculum-admin';
