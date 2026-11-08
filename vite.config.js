import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// npm run dev のときだけ、PCの中のAPI（PGlite）を同じポートで動かす
const localApi = () => ({
  name: "local-api",
  apply: "serve",
  async configureServer(server) {
    const { createLocalApi } = await import("./server/local.js");
    const api = await createLocalApi();
    server.middlewares.use((req, res, next) => api.middleware(req, res, next).catch(next));
  },
});

export default defineConfig({
  plugins: [react(), localApi()],
});
