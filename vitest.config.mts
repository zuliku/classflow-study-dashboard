import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/terminalCapability*.test.ts",
      "tests/terminalToolExposure*.test.ts",
      "tests/terminalCapabilityPrompt*.test.ts",
      "tests/scheduleConflictSameCourse.test.ts",
    ],
  },
});
