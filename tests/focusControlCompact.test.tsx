// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";

// ResizeObserver polyfill（jsdom 未提供）
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = RO;

// Mock useAppStore：FocusControl 只依赖 focusSessions/assignments/courses + toast
const focusSessions = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => {
    const state = {
      focusSessions: focusSessions.current,
      assignments: [],
      courses: [],
    };
    return selector(state);
  },
}));

import { FocusControl } from "@/components/focus/FocusControl";

const focusSession = (status: "running" | "paused", remainingMin: number) => {
  const now = Date.now();
  return {
    id: "f1",
    status,
    plannedMinutes: 30,
    // deriveFocusClock 依赖 number 时间戳
    startedAt: now - remainingMin * 60_000,
    activeStartedAt: status === "running" ? now - remainingMin * 60_000 : undefined,
    accumulatedActiveMs: 0,
    remainingMs: remainingMin * 60_000,
    assignmentId: null,
    courseId: null,
    note: null,
  };
};

describe("FocusControl — Normal 模式", () => {
  beforeEach(() => cleanup());

  it("Paused：显示 Pause 图标 + 倒计时文字 + ChevronDown，且不重复 Ⅱ", () => {
    focusSessions.current = [focusSession("paused", 29)];
    const { container } = render(<FocusControl compact={false} />);
    expect(container.querySelector("svg")).toBeTruthy(); // Pause 图标
    expect(screen.getByText(/· 已暂停/)).toBeTruthy();
    expect(screen.getByText(/\d+:\d+/)).toBeTruthy(); // 倒计时
    expect(container.querySelector("[data-testid='focus-control']")?.textContent).not.toContain("Ⅱ");
    expect(container.querySelector("[data-testid='focus-control']")?.textContent).not.toContain("●");
  });

  it("Running：显示倒计时文字，不出现 ●", () => {
    focusSessions.current = [focusSession("running", 25)];
    const { container } = render(<FocusControl compact={false} />);
    expect(screen.getByText(/· 专注中/)).toBeTruthy();
    expect(container.querySelector("[data-testid='focus-control']")?.textContent).not.toContain("●");
  });

  it("Idle：显示 开始专注 文字 + Play 图标", () => {
    focusSessions.current = [];
    const { container } = render(<FocusControl compact={false} />);
    expect(screen.getByText("开始专注")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("FocusControl — Compact 模式", () => {
  beforeEach(() => cleanup());

  it("Idle：Play 可见，文字与 chevron 隐藏", () => {
    focusSessions.current = [];
    const { container } = render(<FocusControl compact />);
    const btn = container.querySelector("[data-testid='focus-control']") as HTMLElement;
    expect(btn.textContent).not.toContain("开始专注");
    expect(btn.querySelectorAll("svg").length).toBe(1); // 仅 Play，无 ChevronDown
  });

  it("Running：Timer 可见，倒计时与 chevron 隐藏", () => {
    focusSessions.current = [focusSession("running", 25)];
    const { container } = render(<FocusControl compact />);
    const btn = container.querySelector("[data-testid='focus-control']") as HTMLElement;
    expect(btn.textContent).not.toContain("专注中");
    expect(btn.querySelectorAll("svg").length).toBe(1);
  });

  it("Paused：Pause 可见，'已暂停' 与 chevron 隐藏", () => {
    focusSessions.current = [focusSession("paused", 29)];
    const { container } = render(<FocusControl compact />);
    const btn = container.querySelector("[data-testid='focus-control']") as HTMLElement;
    expect(btn.textContent).not.toContain("已暂停");
    expect(btn.querySelectorAll("svg").length).toBe(1);
  });
});

afterEach(() => {
  focusSessions.current = [];
  cleanup();
});
