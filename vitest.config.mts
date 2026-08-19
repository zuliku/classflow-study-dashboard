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
      "tests/scheduleWeekExpression.test.ts",
      "tests/scheduleWeekStrict.test.ts",
      "tests/scheduleWeekIntegration.test.ts",
      "tests/scheduleImportCore.test.ts",
      "tests/timetableImportDomain.test.ts",
      "tests/timetableImportDraft.test.ts",
      "tests/timetableImportPreview.test.tsx",
      "tests/timetableImportRouting.test.ts",
      "tests/timetableImportNormalization.test.ts",
      "tests/timetableImportFinalHardening.test.tsx",
      "tests/aiOpenCodeGoMimoTimetableVisionSmoke.test.ts",
      "tests/focusControlCompact.test.tsx",
      "tests/sidebarChrome.test.ts",
      "tests/terminalStreaming.test.ts",
      "tests/terminalSecretRedaction.test.ts",
      "tests/kiroTerminalBlock.test.tsx",
    ],
  },
});
