import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Split Monaco into its own chunk to keep the main bundle small
        manualChunks: {
          "monaco-editor": ["monaco-editor"],
        },
      },
    },
    // Monaco is large; raise the warning threshold accordingly
    chunkSizeWarningLimit: 5000,
  },
});
