/**
 * Cấu hình ESLint dạng phẳng (flat config) cho toàn repo.
 *
 * Cấu trúc theo đúng pattern chính thức của từng thư viện:
 * - File JavaScript thuần: bộ `recommended` của ESLint (`@eslint/js`)
 *   kèm globals của Node.
 * - Code TypeScript: bộ `recommended` của ESLint + bộ `recommended`
 *   của typescript-eslint (bộ không cần thông tin kiểu — nền lint
 *   chưa dùng các rule type-checked).
 * - Code React (`apps/web`, `packages/ui`, `packages/editor`): preset
 *   `flat.recommended` của eslint-plugin-react-hooks.
 * - File test: preset `recommended` của `@vitest/eslint-plugin`, áp
 *   bổ sung lên rule JS/TS và React nếu khớp glob. Vitest cho phép
 *   thông báo ở đối số thứ hai của expect; e2e/integration dùng
 *   helper chứa assertion ngoài callback test.
 *
 * Root chỉ điều phối bằng `turbo run lint`; từng workspace chạy `eslint .`.
 * Cấu hình chung được ESLint tự tìm từ root; mỗi workspace tự quản
 * baseline `eslint-suppressions.json` cho các lỗi cũ chưa xử lý.
 */
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/.react-router/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: [
      "apps/web/**/*.{ts,tsx}",
      "packages/ui/**/*.{ts,tsx}",
      "packages/editor/**/*.{ts,tsx}",
    ],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: [
      "**/*.spec.{js,mjs,cjs,ts,tsx}",
      "**/*.int-spec.{js,mjs,cjs,ts,tsx}",
      "**/*.e2e-spec.{js,mjs,cjs,ts,tsx}",
    ],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // Vitest hỗ trợ expect(actual, message), khác giới hạn mặc định của plugin.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
  },
  {
    files: [
      "**/*.int-spec.{js,mjs,cjs,ts,tsx}",
      "**/*.e2e-spec.{js,mjs,cjs,ts,tsx}",
    ],
    // Test HTTP/integration dùng helper assert chung ngoài callback it/test.
    // Giữ no-standalone-expect cho unit test để chặn assertion tại top-level.
    rules: { "vitest/no-standalone-expect": "off" },
  },
]);
