import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react()],
  // Local SDK packages expose TypeScript sources; clean builds have no dist artifacts.
  resolve: { conditions: ["source", "module", "browser", "development|production"] },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787", "/oerep": "http://localhost:8787" } },
});
