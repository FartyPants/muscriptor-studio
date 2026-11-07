import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8224";

export default defineConfig({
  base: "/studio/",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(
      ["/studio/api", "/transcribe", "/export", "/auralize", "/sheets", "/health", "/soundfonts"].map(
        (path) => [path, { target: backend, changeOrigin: true }],
      ),
    ),
  },
  build: {
    outDir: "../web_dist",
    emptyOutDir: true,
  },
});
