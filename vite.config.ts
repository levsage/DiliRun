import { defineConfig } from "vitest/config";
import pkg from "./package.json";

// DiliRun ships as static files (GitHub Pages): assets are referenced relative to
// the document, nothing is inlined into the JS bundle, and the preview server binds
// 0.0.0.0 so the sandbox/live-preview proxy can reach it.
export default defineConfig({
  base: "./",
  define: {
    __DILI_VERSION__: JSON.stringify(pkg.version),
  },
  publicDir: "public",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          engine: ["./src/core/Loop.ts", "./src/core/Assets.ts", "./src/render/SpriteAnimator.ts"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
