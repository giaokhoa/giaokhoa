# Hợp đồng dùng chung

`@giaokhoa/shared` cung cấp schema Zod, kiểu dữ liệu và HTTP descriptor, không phụ thuộc framework hay persistence.

Public entry của từng domain và HTTP descriptor (`@giaokhoa/shared/http/*`) được khai báo trong `package.json`.

Schema domain dùng lại cho HTTP khi cùng cấu trúc; tránh tạo alias chỉ để đổi tên.
