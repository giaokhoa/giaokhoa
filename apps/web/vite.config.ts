import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * Cấu hình Vite cho React Router framework mode: plugin `reactRouter()` thay cho plugin React thường (nó tự lo chia chunk theo route và dựng vỏ trang SPA lúc build). Cấu hình test nằm ở vitest.config.ts riêng — Vitest KHÔNG dùng plugin framework này.
 */
export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  // Package contracts xuất CommonJS: để Node nạp ngoài Vite SSR module runner.
  ssr: { external: ["@giaokhoa/contracts"] },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Cho phép mở bản dev qua đường hầm công khai khi review từ xa.
    allowedHosts: [
      ".lhr.life",
      ".trycloudflare.com",
      ".pinggy.net",
      ".pinggy-free.link",
    ],
    // Vite chỉ proxy trong dev; production giao việc này cho Caddyfile. Dùng regex có ranh giới path để /apixyz và /mcpfoo không bị proxy. Bốn nhóm HTTP theo cùng danh sách endpoint trong Caddyfile.
    proxy: {
      "^/api(?:/|\\?|$)": "http://localhost:3000",
      "^/mcp(?:/|\\?|$)": "http://localhost:3000",
      "^/\\.well-known/oauth-protected-resource(?:/|\\?|$)":
        "http://localhost:3000",
      "^/\\.well-known/oauth-authorization-server(?:/|\\?|$)":
        "http://localhost:3000",
      // HTTP polling và WebSocket của Socket.IO dùng cùng một origin.
      "^/socket\\.io(?:/|\\?|$)": { target: "http://localhost:3000", ws: true },
    },
  },
});
