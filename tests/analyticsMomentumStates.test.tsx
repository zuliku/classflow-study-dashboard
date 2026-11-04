// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";

const hookState = vi.hoisted(() => ({
  data: null as null | { days: never[]; streakDays: number; activeToday: boolean; totalMinutes: number; activeDays: number; bestDay: null },
  loading: false,
  error: null as null | Error,
  refresh: vi.fn(),
}));

vi.mock("@/hooks/useStudyMomentum", () => ({
  useStudyMomentum: () => hookState,
}));

import { AnalyticsMomentum } from "@/components/analytics/AnalyticsMomentum";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderNode(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  hookState.data = null;
  hookState.loading = false;
  hookState.error = null;
  hookState.refresh.mockClear();
  vi.useRealTimers();
});

describe("AnalyticsMomentum 三态（N1）", () => {
  it("error 时显示失败文案 + 重试按钮（不再静默消失），点击重试调 refresh", () => {
    hookState.error = new Error("boom");
    const el = renderNode(<AnalyticsMomentum />);
    expect(el.textContent).toContain("学习动量加载失败");
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "重试");
    expect(btn).toBeTruthy();
    act(() => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(hookState.refresh).toHaveBeenCalledTimes(1);
  });

  it("全零空态显示弱引导（84 天全 0 不再只有沉默数字）", () => {
    hookState.data = { days: [], streakDays: 0, activeToday: false, totalMinutes: 0, activeDays: 0, bestDay: null };
    const el = renderNode(<AnalyticsMomentum />);
    expect(el.textContent).toContain("完成 1 个任务或专注 1 次");
  });

  it("有数据时不显示空态引导", () => {
    hookState.data = { days: [], streakDays: 3, activeToday: true, totalMinutes: 90, activeDays: 2, bestDay: null };
    const el = renderNode(<AnalyticsMomentum />);
    expect(el.textContent).not.toContain("完成 1 个任务或专注 1 次");
    expect(el.textContent).toContain("3 天");
  });
});

describe("KiroPendingIndicator 心跳（N2）", () => {
  it("3 秒后显示已等待秒数（首 token 前存活感）", async () => {
    const { KiroPendingIndicator } = await import("@/components/kiro/KiroWorklog");
    // 用 fake timers + 系统时间：该组件按 Date.now() 计算秒数，真实 3.3s 等待在
    // full-suite 并行时会被事件循环拖到 20s 测试超时（曾多次误报）。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const el = renderNode(<KiroPendingIndicator />);
    expect(el.textContent).toContain("正在准备");
    expect(el.textContent).not.toContain("已等待");
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(el.textContent).toContain("已等待");
  });
});
