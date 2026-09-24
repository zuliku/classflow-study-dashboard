// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { AssignmentPeekPanel } from "@/components/assignment/AssignmentPeekPanel";
import { useAppStore } from "@/store/useAppStore";
import { pushOverlay, clearOverlayStack } from "@/lib/overlayStack";
import type { Assignment } from "@/types";

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

/**
 * S2-3 Peek 键盘自持：页脚承诺「Esc 关闭」由面板自己兑现
 * （焦点在面板内时 Table 列表处理器够不到；有 Overlay 在栈上时让栈 own）。
 */
const mkA = (id: string): Assignment =>
  ({ id, courseId: "", title: `任务 ${id}`, description: "", ddl: undefined, priority: "medium", status: "todo", progress: 0, tags: [] }) as Assignment;

function seed() {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [],
    assignments: [mkA("p1")],
    schedules: [],
    calendarMarks: [],
    studyBlocks: [],
    reminders: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: { id: "s", name: "x", startDate: "2026-01-05", totalWeeks: 16 },
    currentSemesterWeek: 1,
    assignmentPeekId: "p1",
    preferences: { ...prefs },
  } as never);
}

function esc() {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

beforeEach(() => {
  cleanup();
  clearOverlayStack();
  seed();
});
afterEach(() => {
  cleanup();
  clearOverlayStack();
});

describe("Peek Esc 自持", () => {
  it("Esc 关闭预览（兑现页脚承诺）", () => {
    render(<AssignmentPeekPanel />);
    expect(screen.getByTestId("assignment-peek")).toBeTruthy();
    esc();
    expect(useAppStore.getState().assignmentPeekId).toBeNull();
  });

  it("有 Overlay 在栈上时让栈 own Esc（不抢 Dialog/Drawer）", () => {
    render(<AssignmentPeekPanel />);
    pushOverlay("test-dialog", 50);
    esc();
    expect(useAppStore.getState().assignmentPeekId).toBe("p1");
  });

  it("面板带可访问名称", () => {
    render(<AssignmentPeekPanel />);
    expect(screen.getByTestId("assignment-peek").getAttribute("aria-label")).toBe("任务快速预览");
  });
});
