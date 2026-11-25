import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 4731,
    proxy: {
      "/hq": "http://127.0.0.1:4732",
      "/api": "http://127.0.0.1:4732",
      "/healthz": "http://127.0.0.1:4732",
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
