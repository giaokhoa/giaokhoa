// Cấu hình Prettier dùng chung toàn monorepo. Các tùy chọn định dạng giữ mặc định của Prettier;
// chỉ khai báo plugin để sắp xếp các class Tailwind trên web/UI/editor.
export default {
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './packages/ui/src/styles/globals.css',
  tailwindFunctions: ['cn'],
};
