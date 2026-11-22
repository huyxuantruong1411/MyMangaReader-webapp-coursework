import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PROXY = {
  "/api": {
    target: "http://127.0.0.1:8020",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: API_PROXY,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: API_PROXY,
  },
});
