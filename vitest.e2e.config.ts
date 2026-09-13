import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 150_000,
    hookTimeout: 30_000,
  },
});
