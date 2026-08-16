// @vitest-environment jsdom
/**
 * UI Hotfix：学习洞察 Loading Skeleton 与 Loaded 使用同一 Paired Grid 常量。
 * （E2E 验证 Loaded 几何 50/50；这里验证 Skeleton 在 DOM 上使用同一 class 字符串，
 *   二者必然同几何 → 无横向 layout shift）
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LearningAnalyticsView, ANALYTICS_PAIRED_GRID } from "@/components/analytics/LearningAnalyticsView";

vi.mock("@/hooks/useLearningAnalytics", () => ({
  useLearningAnalytics: () => ({ data: null, loading: true, error: null }),
}));
vi.mock("@/hooks/useStudyOutlook", () => ({
  useStudyOutlook: () => ({ data: null, loading: true, error: null }),
}));
vi.mock("@/hooks/useEffectiveReducedMotion", () => ({
  useEffectiveReducedMotion: () => false,
}));

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: true,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

function renderView() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<LearningAnalyticsView />);
  });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, cleanup };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Analytics Paired Grid：常量语义", () => {
  it("ANALYTICS_PAIRED_GRID = 1col mobile + 50/50 desktop；不含 70/30 残留", () => {
    expect(ANALYTICS_PAIRED_GRID).toBe("grid grid-cols-1 lg:grid-cols-2 gap-4 items-start");
    expect(ANALYTICS_PAIRED_GRID).not.toContain("2fr");
    expect(ANALYTICS_PAIRED_GRID).not.toContain("0.8fr");
    expect(ANALYTICS_PAIRED_GRID).not.toContain("280px");
  });

  it("Loading Skeleton 的两个 paired grid 使用与 Loaded 相同的 ANALYTICS_PAIRED_GRID", () => {
    const { container, cleanup } = renderView();
    // Skeleton 阶段只有 2 个 paired grid（trend 行 + 投入行）；outlook skeleton 是独立 full-width
    const grids = Array.from(container.querySelectorAll(".grid")).filter((el) => {
      const cls = (el as HTMLElement).className;
      return cls.includes("lg:grid-cols-2") && cls.includes("items-start");
    });
    expect(grids.length).toBe(2);
    for (const g of grids) {
      expect((g as HTMLElement).className).toBe(ANALYTICS_PAIRED_GRID);
    }
    // 全页面不存在 2fr/0.8fr（Skeleton 不得保留旧列几何）
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    const html = container.innerHTML;
    expect(html).not.toContain("2fr");
    expect(html).not.toContain("0.8fr");
    cleanup();
  });
});
