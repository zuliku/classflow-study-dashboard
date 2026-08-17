// @vitest-environment jsdom
/**
 * useLearningAnalytics 请求归属回归（Analytics V3.1 §44）：
 * 快速 本周 → 近4周 → 本学期：旧 async result 不能覆盖最新 preset。
 * hook 已有 generation-token 防 stale；此测试锁定可观察契约（最终必须显示本学期）。
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useLearningAnalytics } from "@/hooks/useLearningAnalytics";
import { AnalyticsRangePreset } from "@/lib/analytics/types";
import { clearLearningHistoryStorage, setLearningHistoryCoverage } from "@/lib/history/store";
import { useAppStore } from "@/store/useAppStore";

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

function Harness({ preset }: { preset: AnalyticsRangePreset }) {
  const { data, loading } = useLearningAnalytics(preset);
  return <div data-preset={data?.period.preset ?? "null"} data-loading={String(loading)} />;
}

async function settle(ms = 300) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("useLearningAnalytics 请求归属", () => {
  beforeEach(async () => {
    useAppStore.setState({ semester: { id: "sem1", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 } as never });
    await clearLearningHistoryStorage();
    await setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: new Date(2026, 7, 1).getTime(),
      initializedAt: new Date(2026, 7, 1).getTime(),
      focusBackfillCompleted: false,
      backfilledFocusSessions: 0,
    });
  });

  it("快速 本周→近4周→本学期：最终显示本学期 snapshot（旧请求不覆盖）", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness preset="week" />);
    });
    await settle(200);
    // 快速连切（不等中间请求完成）
    await act(async () => {
      root.render(<Harness preset="4weeks" />);
    });
    await act(async () => {
      root.render(<Harness preset="semester" />);
    });
    // 等待全部 async 结果落定
    await settle(600);

    const el = container.querySelector("[data-preset]")!;
    expect(el.getAttribute("data-preset")).toBe("semester");
    expect(el.getAttribute("data-loading")).toBe("false");
    act(() => root.unmount());
    container.remove();
  });

  it("preset 切换期间 loading 为 true（旧数据被隐藏，无 stale flash）", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness preset="week" />);
    });
    await settle(300);
    // 切 4weeks 后采样：loading 应已为 true（旧数据隐藏，无 stale flash）
    await act(async () => {
      root.render(<Harness preset="4weeks" />);
    });
    const loadingNow = container.querySelector("[data-loading]")?.getAttribute("data-loading") ?? "";
    expect(loadingNow).toBe("true");
    await settle(600);
    expect(container.querySelector("[data-preset]")?.getAttribute("data-preset")).toBe("4weeks");
    act(() => root.unmount());
    container.remove();
  });
});
