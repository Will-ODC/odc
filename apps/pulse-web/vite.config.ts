import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The API runs alongside in dev; same-origin so the session cookie works
    // without any CORS or SameSite special-casing.
    proxy: { "/api": "http://localhost:8080" },
  },
});
