# AGENTS.md — ESLint Config

Package chỉ chứa preset ESLint dùng chung và cấu hình lint của chính package. Không đưa đường dẫn `apps/*` hay `packages/*` đặc thù vào preset chung. Mỗi workspace tự quản lý ESLint Flat Config và suppression của mình.

Parser `typescript-eslint` dùng phiên bản TypeScript được parser hỗ trợ; không thay phiên bản compiler của các package tiêu thụ chỉ để phục vụ lint. Giữ các rule và ngoại lệ Vitest đang được dùng khi sửa preset. Không viết comment trong code hoặc cấu hình; tài liệu bằng tiếng Việt theo `/AGENTS.md`. Luật PR, review và cleanup kế thừa từ `/AGENTS.md`.
