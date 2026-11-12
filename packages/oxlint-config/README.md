# @giaokhoa/oxlint-config

Preset Oxlint cho các workspace TypeScript 7. Package sở hữu
`.oxlintrc.json` và lệnh `lint`; Turborepo chỉ điều phối.

`base.json` bật những quy tắc quan trọng ở mức `error` cho JavaScript,
TypeScript và Vitest; `react.json` bổ sung các quy tắc React Compiler.
Package tự chọn preset cần thiết. Cấu hình bật `typeAware` và
`typeCheck`: Oxlint dùng `oxlint-tsgolint@7.0.2006` để kiểm kiểu bằng
TypeScript 7, không cần parser TypeScript 6.

Chỉ đưa vào baseline các quy tắc đã đối chiếu. Các quy tắc type-aware
mở rộng (như `no-misused-promises`) chưa được bật mặc định vì phát hiện
nhiều vấn đề mới cần sửa và kiểm thử hành vi riêng; không dùng file
suppression hoặc tự động giảm severity để che lỗi đang bật.

Với package import workspace nội bộ qua `exports` trỏ tới `dist`,
khai `turbo.json` local với `lint.dependsOn: ["^build"]` để Turbo
build các dependency trước type-aware lint, kể cả trong CI checkout sạch.
Không cần dựng build của chính package lint.
