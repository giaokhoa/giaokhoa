import type { Config } from "@react-router/dev/config";

/**
 * React Router phục vụ SSR cho mọi route qua `@react-router/serve`.
 *
 * Không prerender `/` và `/login`: root loader phụ thuộc cookie phiên Better Auth và cookie sidebar của chính request. Server dựng sẵn không phân biệt phiên khi phục vụ file HTML tĩnh, vì vậy luôn render động để tránh đưa trạng thái của người dùng khác vào trang.
 *
 * Reverse proxy cùng origin (API, Socket.IO, MCP) do Caddy quản lý ở `Caddyfile`, không viết HTTP server và proxy Node riêng.
 */
export default {
  ssr: true,
  // Đặt toàn bộ src làm appDirectory để typegen nhận route modules ở src/features.
  appDirectory: "src",
} satisfies Config;
