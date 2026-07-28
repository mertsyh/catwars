import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  publicDir: "../../resources",
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
