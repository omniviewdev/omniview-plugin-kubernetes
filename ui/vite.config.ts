import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

const reactCompilerConfig = {
  target: "19",
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", reactCompilerConfig]],
      },
    }),
    // react/compiler-runtime must be shared until @omniviewdev/vite-plugin is republished
    omniviewExternals({ additionalShared: ["react/compiler-runtime"] }),
  ],
  server: {
    host: '127.0.0.1',
    cors: true,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
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
