import { defineConfig } from "eslint/config";
import { ignores, javascript } from "./index.mjs";

export default defineConfig([ignores, javascript]);
