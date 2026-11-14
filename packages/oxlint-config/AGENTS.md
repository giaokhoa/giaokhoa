# AGENTS.md — Oxlint Config

Package chứa preset dùng chung Oxlint cho workspace TypeScript. Giữ ranh giới package: package tự chọn `base.json` và `react.json`. Không đưa đường dẫn app/package cụ thể vào preset chung. Các rule quan trọng phải ở mức error. Không đưa suppression cũ vào cấu hình mới; sửa code trước khi yêu cầu lint xanh. Không viết comment trong code hoặc cấu hình; tài liệu bằng tiếng Việt. Luật PR, review và cleanup kế thừa từ `/AGENTS.md`.
