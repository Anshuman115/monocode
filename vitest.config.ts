import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Guarantees React resolves its development build, which is the only one
    // that exports `act`. Without this, an ambient NODE_ENV=production makes
    // every `import { act } from "react"` in the UI tests resolve to undefined.
    env: { NODE_ENV: "test" },
    setupFiles: ["./src/testSetup.ts"],
  },
});
