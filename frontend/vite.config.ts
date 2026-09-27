// Development server settings and a same-origin proxy for authenticated REST and WebSocket requests.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    watch: { usePolling: true, interval: 500 },
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    // Keep REST and WebSocket traffic on one browser origin so cookie authentication works in development.
    proxy: {
      "/api": {
        target: process.env.TRIPBOARD_API_TARGET || "http://127.0.0.1:8001",
        ws: true,
      },
    },
  },
});
