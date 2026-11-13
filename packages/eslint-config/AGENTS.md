# AGENTS.md — ESLint Config

Package chỉ chứa các preset ESLint dùng chung và cấu hình lint của chính package. Không đưa đường dẫn \`apps/_\` hay \`packages/_\` đặc thù vào preset chung. Mỗi workspace tự quản lý ESLint Flat Config và suppression của mình.

Parser \`typescript-eslint\` phải dùng TypeScript 6 được hỗ trợ; không thay phiên bản compiler TypeScript 7 của các package tiêu thụ. Giữ nguyên các rule và ngoại lệ Vitest hiện hành khi sửa preset. Comment trong code và tài liệu viết bằng tiếng Việt theo \`/AGENTS.md\`.
