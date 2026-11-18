import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri v2 serves the built frontend from local files. Keep the bundle
// portable: relative asset paths, no Node APIs in the frontend, no dev-only
// network calls. The only runtime network call the app ever makes is the
// user-configured OpenAI-compatible endpoint.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
