import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const snapshotBase = (
    env.VITE_SNAPSHOT_BASE_URL ||
    env.SNAPSHOT_BASE_URL ||
    ""
  ).replace(/\/$/, "");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: snapshotBase
        ? {
            "/api/latest": {
              target: snapshotBase,
              changeOrigin: true,
              rewrite: () => "/latest.json",
            },
          }
        : undefined,
    },
  };
});
