import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    pool: "vmThreads",
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"],
        },
      },
    ],
    testTimeout: 20_000,
  },
});
