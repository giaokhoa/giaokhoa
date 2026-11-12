import { defineConfig } from "eslint/config";
import {
  ignores,
  javascript,
  typescript,
  vitestTests,
  integrationTests,
} from "@giaokhoa/eslint-config";

export default defineConfig([
  ignores,
  javascript,
  typescript(import.meta.dirname),
  vitestTests,
  integrationTests,
]);
