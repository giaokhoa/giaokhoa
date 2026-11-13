// Cấu hình Prettier dùng chung toàn monorepo. Các tùy chọn định dạng giữ mặc định của Prettier;
// chỉ khai báo plugin để sắp xếp các class Tailwind trên web/UI/editor.
export default {
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './packages/ui/src/styles/globals.css',
  tailwindFunctions: ['cn'],
  // packages/contracts viết bằng nháy đơn ở mọi file (trừ support-grants.ts
  // và support-grants.spec.ts dùng nháy đôi): chốt nháy đơn riêng cho package
  // này để `pnpm format` không lật toàn bộ package sang nháy đôi.
  overrides: [{ files: 'packages/contracts/**', options: { singleQuote: true } }],
};
