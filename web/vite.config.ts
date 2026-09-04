import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.TANDEM_API ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/auth": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
      "/collab": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
