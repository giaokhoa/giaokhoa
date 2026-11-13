# @giaokhoa/config — README

> File này ghi các **quyết định còn đang hiệu lực** của package. Nguồn sự thật về quyết định của package là chính file này, `AGENTS.md` của package và `AGENTS.md` ở thư mục gốc; quyết định liên quan tới một việc cụ thể được viết trọn vẹn trong issue đặc tả của việc đó trên GitHub.

## Package phụ trách gì

`packages/config` chứa các **cấu hình TypeScript dùng chung** của monorepo (`tsconfig/base.json`, `nest.json`, `react.json`) để mọi app/package biên dịch theo cùng một kỷ luật kiểu. Package này **không mang quyết định nghiệp vụ nào** — ghi rõ điều đó ở đây để không ai đi tìm (hoặc tự nhét) nghiệp vụ vào đây.

## Quyết định còn hiệu lực

| Quyết định                                                                                                                                                                                                                        | Nguồn                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Hai dòng TypeScript tách riêng theo nền: dòng NestJS (apps/api, apps/worker) theo `nest.json` (TypeScript 6), dòng React (apps/web và các package giao diện) theo `react.json` (TypeScript 7). Không ép một dòng cho cả monorepo. | README gốc của repo (mục Version policy) |
| Mọi package kế thừa từ các base này thay vì tự khai tsconfig rời — kỷ luật kiểu (strictness, module resolution) là dùng chung, đổi một chỗ áp cho toàn hệ.                                                                        | Cấu trúc monorepo hiện hành              |

### Phân giải module và đường build

- `tsconfig/nest.json` dùng `module: NodeNext` và `moduleResolution: NodeNext`. Với các package backend không có `"type": "module"` trong package.json, TypeScript biên dịch JavaScript thành CommonJS, không làm đổi hợp đồng Node 24 hiện hành. Không cần `ignoreDeprecations`.
- `apps/api` và `apps/worker` chứa test TypeScript chạy bằng Vitest (Vite xử lý import tương đối không kèm phần mở rộng): hai app đặt `module: ESNext` + `moduleResolution: Bundler` **chỉ** trong `tsconfig.json` dùng cho `typecheck` bao gồm test. `tsconfig.build.json` ghi đè cặp đó về `NodeNext` khi Nest CLI phát JavaScript production. Cổng CI `build` và `typecheck` kiểm cả hai đường; không dùng Bundler để phát JavaScript Node production.
- Package `db` và các package thuần backend dùng NodeNext trực tiếp. Khi không còn Node10, TypeScript tự đọc `exports` của `kysely/migration`, không dùng khai báo module giả trùm lên type gốc của thư viện.

## Ranh giới — package này KHÔNG làm gì

- Không chứa code chạy (runtime), không chứa hằng số nghiệp vụ, không chứa cấu hình môi trường/secret: cấu hình nghiệp vụ cấp site thuộc site-config ở `apps/api` + hợp đồng ở `packages/contracts`; biến môi trường thuộc từng app.
- Không chứa ESLint rule nghiệp vụ riêng hay preset giao diện.

## Kỹ thuật tối thiểu

- Chỉ có các file JSON tsconfig; `package.json` không khai script `typecheck`/`test`/`build`. Turbo bỏ qua các tác vụ không tồn tại cho package này; tính đúng đắn được kiểm chứng qua typecheck của app/package tiêu thụ.
