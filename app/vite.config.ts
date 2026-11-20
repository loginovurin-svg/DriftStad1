import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import gameBuildOutput from "./scripts/build-output";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
  const port = Number(process.env.PORT ?? 3000);
  const base = command === "build"
    ? process.env.PAGES_BASE_PATH ?? process.env.BASE_PATH ?? "/DriftLabe/"
    : process.env.BASE_PATH ?? "/";

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${process.env.PORT ?? ""}`);
  }

  return {
    base,
    plugins: [react(), gameBuildOutput()],
    resolve: {
      alias: {
        "@": resolve(root, "src"),
      },
      dedupe: ["react", "react-dom"],
    },
    build: {
      outDir: resolve(root, "dist/public"),
      emptyOutDir: false,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
