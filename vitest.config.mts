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
      "tests/extensionsRegistry.test.ts",
      "tests/extensionsPermissions.test.ts",
      "tests/secretVault.test.ts",
      "tests/securityBaseline.test.ts",
      "tests/settingsRegistry.test.ts",
      // Kiro Sidecar Capsule V1 — jsdom via @vitest-environment
      "tests/kiroSidecarShell.test.tsx",
      "tests/kiroSidecarSize.test.ts",
      "tests/sidecarPosition.test.ts",
      "tests/kiroRuntime.test.ts",
      "tests/kiroSidecarMinimizedPosition.test.ts",
      "tests/kiroSidecarPreferences.test.ts",
      "tests/kiroSidecarCapsule.test.tsx",
    ],
  },
});
