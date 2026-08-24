// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({
    handoffPrompt: vi.fn(),
    handoffAssignmentPrompt: vi.fn(),
    openForWeek: vi.fn(),
    openForGroupProject: vi.fn(),
  }),
}));

import { TimelineActiveFocusChip } from "@/components/timeline/TimelineActiveFocusChip";
import { useAppStore } from "@/store/useAppStore";
import type { FocusSession } from "@/types";

/**
 * Workflow UX V10 —— Timeline Header Active Focus Chip：
 * - idle return null；running/paused 展示 剩余时间 · 状态 + 目标名
 * - 目标名优先级：有效 Assignment.title → assignmentTitleSnapshot → 有效 Course.name
 *   → courseNameSnapshot → 未关联专注
 * - 点击路由：Assignment Drawer（global owner，activeTab 保持 timetable）→ Course Drawer → 只读
 * - 性能契约（静态）：useFocusClock 的 1s tick 只允许存在于 TimelineActiveFocusChip，
 *   TimelineWorkspace 禁止调用
 */

const NOW = Date.now();

const mkSession = (over: Partial<FocusSession> = {}): FocusSession =>
  ({
    id: "f-live",
    plannedMinutes: 25,
    startedAt: NOW - 70_000,
    activeStartedAt: NOW - 10_000,
    accumulatedActiveMs: 60_000,
    status: "running",
    assignmentId: "a-chip",
    courseId: "c-chip",
    assignmentTitleSnapshot: "快照任务名",
    courseNameSnapshot: "快照课程名",
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as FocusSession;

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    assignments: [{ id: "a-chip", title: "真实任务甲", courseId: "c-chip" } as never],
    courses: [{ id: "c-chip", name: "计量经济学" } as never],
    focusSessions: [],
    selectedAssignmentId: null,
    selectedCourseId: null,
    activeTab: "timetable" as never,
  });
});
afterEach(() => {
  cleanup();
});

describe("TimelineActiveFocusChip", () => {
  it("idle（无 running/paused）→ 不渲染 chip", () => {
    const { container } = render(<TimelineActiveFocusChip />);
    expect(screen.queryByTestId("timeline-active-focus-chip")).toBeNull();
    expect(container.childElementCount).toBe(0);
  });

  it("running → 显示专注中 + 剩余 mm:ss", () => {
    useAppStore.setState({ focusSessions: [mkSession()] });
    render(<TimelineActiveFocusChip />);
    const chip = screen.getByTestId("timeline-active-focus-chip");
    expect(chip.textContent).toContain("专注中");
    expect(chip.textContent).toMatch(/\d{2}:\d{2}/);
    // 有效 Assignment.title 优先于 snapshot
    expect(chip.textContent).toContain("真实任务甲");
  });

  it("paused → 显示已暂停", () => {
    useAppStore.setState({
      focusSessions: [mkSession({ status: "paused", activeStartedAt: undefined })],
    });
    render(<TimelineActiveFocusChip />);
    expect(screen.getByTestId("timeline-active-focus-chip").textContent).toContain("已暂停");
  });

  it("Assignment 已删除 → 使用 assignmentTitleSnapshot", () => {
    useAppStore.setState({
      assignments: [],
      focusSessions: [mkSession({ assignmentTitleSnapshot: "已删任务的快照" })],
    });
    render(<TimelineActiveFocusChip />);
    expect(screen.getByTestId("timeline-active-focus-chip").textContent).toContain(
      "已删任务的快照"
    );
  });

  it("Assignment 缺失但 Course 有效 → 点击打开 Course", () => {
    useAppStore.setState({ assignments: [], focusSessions: [mkSession()] });
    render(<TimelineActiveFocusChip />);
    fireEvent.click(screen.getByTestId("timeline-active-focus-chip"));
    expect(useAppStore.getState().selectedCourseId).toBe("c-chip");
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });

  it("Assignment 有效 → 点击打开 Assignment（global owner）", () => {
    useAppStore.setState({ focusSessions: [mkSession()] });
    render(<TimelineActiveFocusChip />);
    fireEvent.click(screen.getByTestId("timeline-active-focus-chip"));
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-chip");
    // 不跳 Assignment Workspace：用户关闭 Drawer 后仍停留在 Timeline
    expect(useAppStore.getState().activeTab).toBe("timetable");
  });

  it("无关联实体 → 只读 chip（disabled，点击不导航）", () => {
    useAppStore.setState({
      assignments: [],
      courses: [],
      focusSessions: [
        mkSession({ assignmentId: undefined, courseId: undefined, assignmentTitleSnapshot: undefined, courseNameSnapshot: undefined }),
      ],
    });
    render(<TimelineActiveFocusChip />);
    const chip = screen.getByTestId("timeline-active-focus-chip") as HTMLButtonElement;
    expect(chip.textContent).toContain("未关联专注");
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
    expect(useAppStore.getState().selectedCourseId).toBeNull();
  });

  it("completed 后 → chip 消失（active 会话不再存在）", () => {
    useAppStore.setState({ focusSessions: [mkSession()] });
    const { rerender } = render(<TimelineActiveFocusChip />);
    expect(screen.getByTestId("timeline-active-focus-chip")).toBeTruthy();

    useAppStore.setState({
      focusSessions: [mkSession({ status: "completed", activeStartedAt: undefined, endedAt: NOW })],
    });
    rerender(<TimelineActiveFocusChip />);
    expect(screen.queryByTestId("timeline-active-focus-chip")).toBeNull();
  });
});

// ============================================================
// Workflow UX V10 —— Header placement + 1s tick 隔离（静态契约）
// ============================================================
describe("Active Focus static contract", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("useFocusClock 只出现在 TimelineActiveFocusChip；TimelineWorkspace 禁止每秒 tick", () => {
    const ws = read("components/timeline/TimelineWorkspace.tsx");
    const chip = read("components/timeline/TimelineActiveFocusChip.tsx");
    // TimelineWorkspace 只做无 tick 投影（anchor/status），不得引入 1s interval hook
    expect(ws).not.toContain("useFocusClock");
    expect(ws).not.toContain("setInterval");
    expect(chip).toContain("useFocusClock");
  });

  it("Header placement：chip 位于 WorkspaceHeader.actions（Ask Kiro 之前）", () => {
    const ws = read("components/timeline/TimelineWorkspace.tsx");
    const chipIdx = ws.indexOf("<TimelineActiveFocusChip />");
    expect(chipIdx).toBeGreaterThan(-1);
    const headerActionsIdx = ws.indexOf("const headerActions");
    const kiroIdx = ws.indexOf("<KiroFlowButton");
    expect(chipIdx).toBeGreaterThan(headerActionsIdx);
    expect(chipIdx).toBeLessThan(kiroIdx);
  });
});
