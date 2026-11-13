import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  ssr: { external: ["@giaokhoa/contracts"] },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      ".lhr.life",
      ".trycloudflare.com",
      ".pinggy.net",
      ".pinggy-free.link",
    ],
    proxy: {
      "^/api(?:/|\\?|$)": "http://localhost:3000",
      "^/mcp(?:/|\\?|$)": "http://localhost:3000",
      "^/\\.well-known/oauth-protected-resource(?:/|\\?|$)":
        "http://localhost:3000",
      "^/\\.well-known/oauth-authorization-server(?:/|\\?|$)":
        "http://localhost:3000",
      "^/socket\\.io(?:/|\\?|$)": { target: "http://localhost:3000", ws: true },
    },
  },
});
