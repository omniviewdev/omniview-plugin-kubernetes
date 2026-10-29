import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";
import { injectCssIntoEntry } from "./vite/omniview";
import { resolvePluginId } from "./vite/pluginId";

const pluginId = resolvePluginId();
// Vite exposes VITE_* process variables as import.meta.env, which it inlines
// into every module in dev as well as in builds; `define` is not applied to
// modules the host loads from the dev server.
process.env.VITE_OMNIVIEW_PLUGIN_ID = pluginId;

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY,
  plugins: [
    react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] } }),
    omniviewExternals(),
    injectCssIntoEntry(pluginId),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    cors: true,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
    outDir: process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist',
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: "src/entry.ts",
      output: {
        entryFileNames: "assets/entry.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
    }
  },
});
