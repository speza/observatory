import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: process.env.AO_DESKTOP_DEV === "1" ? 4330 : 4310,
    strictPort: true,
    proxy: {
      "/api": {
        target:
          process.env.AO_DESKTOP_DEV === "1" ? "http://127.0.0.1:4331" : "http://127.0.0.1:4311",
        ws: true,
      },
    },
  },
});
