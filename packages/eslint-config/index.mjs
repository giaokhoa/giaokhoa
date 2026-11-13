/**
 * Các preset ESLint dùng chung, không phụ thuộc đường dẫn workspace. Mỗi package tự chọn preset và khai tsconfigRootDir tại config của mình.
 */
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export const ignores = globalIgnores([
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.react-router/**",
]);

export const javascript = {
  files: ["**/*.{js,mjs,cjs}"],
  extends: [js.configs.recommended],
  languageOptions: { globals: globals.node },
};

export const typescript = (tsconfigRootDir) => ({
  files: ["**/*.{ts,tsx,mts,cts}"],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  languageOptions: {
    parserOptions: { tsconfigRootDir },
  },
  rules: {
    // Giữ quy ước TypeScript: tên bắt đầu bằng _ biểu thị biến/đối số được cố ý bỏ qua, thay vì tắt rule hay suppression cả file.
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "after-used",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
  },
});

export const vitestTests = {
  files: [
    "**/*.spec.{js,mjs,cjs,ts,tsx}",
    "**/*.int-spec.{js,mjs,cjs,ts,tsx}",
    "**/*.e2e-spec.{js,mjs,cjs,ts,tsx}",
  ],
  ...vitest.configs.recommended,
  rules: {
    ...vitest.configs.recommended.rules,
    // Vitest chấp nhận thông báo ở đối số thứ hai của expect.
    "vitest/valid-expect": ["error", { maxArgs: 2 }],
  },
};

export const integrationTests = {
  files: [
    "**/*.int-spec.{js,mjs,cjs,ts,tsx}",
    "**/*.e2e-spec.{js,mjs,cjs,ts,tsx}",
  ],
  // Helper kiểm chứng HTTP/integration có thể nằm ngoài callback test.
  rules: { "vitest/no-standalone-expect": "off" },
};
