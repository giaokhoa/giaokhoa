/**
 * Regex khớp UUIDv7 đầy đủ (S13): 8-4-4-4-12 hex, version `7` ở nhóm
 * thứ ba, variant `8`/`9`/`a`/`b` ở đầu nhóm thứ tư. Một hằng duy nhất
 * cho mọi spec — trước đây mỗi spec giữ một bản sao (`UUIDV7_PATTERN` /
 * `UUIDV7_RE` / viết inline), và một bản rút gọn chỉ khớp tiền tố.
 */
export const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
