import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // strictPort so a clash fails loudly instead of silently drifting to 5174+: a
  // wandering dev port used to confuse agent auto-detection. 5188 keeps us off the
  // default 5173 (reserved here for another local project). detectAgent() excludes
  // any localhost port, so the exact number isn't load-bearing — but pinning it
  // keeps the dev origin and docs in agreement.
  server: { host: true, port: 5188, strictPort: true },
});
