import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, pool: "forks" }, // setup (in-memory database, site builds) can be slow while other files run
});
