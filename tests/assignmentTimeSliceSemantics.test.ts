import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { SETTINGS_REGISTRY, searchSettings } from "@/lib/settingsRegistry";

/**
 * V5A3 Assignment Filter Semantic Truth：
 * Truth 1 — assignmentTimeSlice 不属于 Settings preference（Registry/DOM/Search 均无）
 * Truth 2 — assignmentTimeSlice 仍属于 Overview compact AssignmentTable state（Store + 消费保留，Workspace 未接入）
 */
function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("V5A3 assignment filter semantic truth", () => {
  it("Truth 1：Registry 不再登记 assignment-time-slice", () => {
    expect(SETTINGS_REGISTRY.some((s) => s.id === "assignment-time-slice")).toBe(false);
  });

  it("Truth 1：TaskSettings DOM 不再包含该 target", () => {
    const src = readSource("components/settings/TaskSettings.tsx");
    expect(src).not.toContain("assignment-time-slice");
  });

  it("Truth 1：搜索不再返回该 dead setting", () => {
    expect(
      searchSettings("assignment-time-slice").some((s) => s.id === "assignment-time-slice")
    ).toBe(false);
    expect(
      searchSettings("任务列表默认筛选").some((s) => s.id === "assignment-time-slice")
    ).toBe(false);
    expect(
      searchSettings("任务工作区默认筛选").some((s) => s.id === "assignment-time-slice")
    ).toBe(false);
  });

  describe("Truth 2：仍是 Overview compact state", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    async function freshStore() {
      vi.resetModules();
      const mod = await import("@/store/useAppStore");
      return mod.useAppStore;
    }

    it("Store 仍保留 assignmentTimeSlice + setAssignmentTimeSlice", async () => {
      const store = await freshStore();
      expect(store.getState().assignmentTimeSlice).toBe("all");
      store.getState().setAssignmentTimeSlice("today");
      expect(store.getState().assignmentTimeSlice).toBe("today");
      store.getState().setAssignmentTimeSlice("7days");
      expect(store.getState().assignmentTimeSlice).toBe("7days");
    });

    it("Overview compact AssignmentTable 仍消费该 state", () => {
      const src = readSource("components/dashboard/AssignmentTable.tsx");
      expect(src).toContain("s.assignmentTimeSlice");
      expect(src).toContain("setAssignmentTimeSlice");
    });

    it("Assignment Workspace 未被接入 assignmentTimeSlice", () => {
      for (const rel of [
        "components/assignment/AssignmentsWorkspace.tsx",
        "hooks/useAssignmentWorkspaceController.ts",
      ]) {
        expect(readSource(rel)).not.toContain("assignmentTimeSlice");
      }
    });
  });
});
