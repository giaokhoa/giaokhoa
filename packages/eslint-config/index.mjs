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
  rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
};

export const typescript = (tsconfigRootDir) => ({
  files: ["**/*.{ts,tsx,mts,cts}"],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  languageOptions: {
    parserOptions: { tsconfigRootDir },
  },
  rules: {
    "no-empty": ["error", { allowEmptyCatch: true }],
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
    "vitest/valid-expect": ["error", { maxArgs: 2 }],
  },
};

export const integrationTests = {
  files: [
    "**/*.int-spec.{js,mjs,cjs,ts,tsx}",
    "**/*.e2e-spec.{js,mjs,cjs,ts,tsx}",
  ],
  rules: { "vitest/no-standalone-expect": "off" },
};
