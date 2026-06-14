import { defineConfig } from "vitest/config";

// Unit tests run in jsdom (the app touches localStorage / document / location)
// and cover the agent's pure key-resolution too. We intentionally use explicit
// `import { describe, ... } from "vitest"` rather than globals, so the
// production `tsc -b` build needs no extra ambient types (test files are also
// excluded from that build in tsconfig.json).
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "agent/**/*.test.js"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
