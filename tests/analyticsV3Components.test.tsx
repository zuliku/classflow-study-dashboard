// @vitest-environment jsdom
/**
 * Analytics V3 组件测试（AnalyticsSummaryStrip / LearningTrendChart / CourseInvestmentCard）。
 * jsdom + react-dom/client + act；图表用 svg 文本断言（Recharts 在 jsdom 可渲染）。
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnalyticsSummaryStrip, AnalyticsSummaryStripSkeleton } from "@/components/analytics/AnalyticsSummaryStrip";
import { LearningTrendChart } from "@/components/analytics/LearningTrendChart";
import { CourseInvestmentCard } from "@/components/analytics/CourseInvestmentCard";
import { presentCourseInvestment } from "@/lib/analytics/presentation";
import { AnalyticsPeriod } from "@/lib/analytics/types";
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
// Recharts ResponsiveContainer 需要 ResizeObserver
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// useEffectiveReducedMotion 读取 store preferences → 提供默认
useAppStore.getState();

const PERIOD: AnalyticsPeriod = {
  preset: "week",
  current: { from: new Date(2026, 7, 17, 0, 0, 0).getTime(), to: new Date(2026, 7, 23, 20, 0, 0).getTime() },
  previous: null,
  trendGrain: "day",
};

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AnalyticsSummaryStrip", () => {
  it("A：partial metric → —；positive partial → 已记录 copy", () => {
    const h = render(
      <AnalyticsSummaryStrip
        metrics={[
          { label: "实际专注", view: { value: "—", detail: "该区间记录不完整", reliability: "partial" } },
          { label: "完成任务", view: { value: "已记录 3 项", detail: "当前区间可能不完整", reliability: "partial" } },
          { label: "计划执行", view: { value: "—", detail: "计划记录不完整", reliability: "partial" } },
          { label: "按时完成", view: { value: "—", detail: "该区间记录不完整", reliability: "partial" } },
        ]}
      />
    );
    expect(h.container.textContent).toContain("该区间记录不完整");
    expect(h.container.textContent).toContain("已记录 3 项");
    expect(h.container.getAttribute("data-testid")).toBeNull();
    h.cleanup();
  });

  it("C：计划执行 → % + 实际/计划 detail", () => {
    const h = render(
      <AnalyticsSummaryStrip
        metrics={[
          { label: "实际专注", view: { value: "2 小时 3 分", reliability: "complete" } },
          { label: "完成任务", view: { value: "4 项", reliability: "complete" } },
          { label: "计划执行", view: { value: "82%", detail: "实际 2 小时 3 分 / 计划 2 小时 30 分", reliability: "complete" } },
          { label: "按时完成", view: { value: "75%", detail: "3 / 4 个可判断任务按时完成", reliability: "complete" } },
        ]}
      />
    );
    expect(h.container.textContent).toContain("82%");
    expect(h.container.textContent).toContain("实际 2 小时 3 分 / 计划 2 小时 30 分");
    h.cleanup();
  });
});

describe("LearningTrendChart", () => {
  it("D：legend + 单位 + 计划不可用提示（raw ISO label / tooltip 由 E2E F 覆盖）", () => {
    const h = render(
      <LearningTrendChart
        period={PERIOD}
        points={[
          { key: "2026-08-17", label: "8/17 周一", focusMinutes: 25, plannedMinutes: null, completedAssignments: 0 },
          { key: "2026-08-18", label: "8/18 周二", focusMinutes: 0, plannedMinutes: null, completedAssignments: 0 },
          { key: "2026-08-19", label: "8/19 周三", focusMinutes: null, plannedMinutes: null, completedAssignments: null },
        ]}
      />
    );
    const text = h.container.textContent ?? "";
    // 计划无任何可靠 bucket → 提示代替计划 legend
    expect(text).toContain("计划记录不足，暂不显示完整计划序列");
    expect(text).toContain("单位：分钟");
    expect(text).toContain("实际专注");
    expect(text).not.toContain("计划学习"); // 无可靠计划值时不显示计划 legend
    h.cleanup();
  });
});

describe("CourseInvestmentCard", () => {
  it("E：Top5 + Other；F：多个 linked Course 无重复「未关联课程」；中性色用于 其他/未关联", () => {
    const investment = presentCourseInvestment(
      [
        { courseId: "c1", courseName: "数据分析", minutes: 120, sessions: 3, share: 0.5 },
        { courseId: null, courseName: "未关联课程", minutes: 80, sessions: 2, share: 0.33 },
        { courseId: "c2", courseName: null, minutes: 40, sessions: 1, share: 0.17 },
      ],
      { c1: "数据分析", c2: "数据库系统" }
    );
    expect(investment.map((i) => i.courseName)).toEqual(["数据分析", "未关联课程", "数据库系统"]);
    expect(investment.filter((i) => i.courseName === "未关联课程")).toHaveLength(1);

    const h = render(<CourseInvestmentCard investment={investment} />);
    const text = h.container.textContent ?? "";
    expect(text).toContain("数据分析");
    expect(text).toContain("数据库系统"); // fallback 到 current name
    expect(text).toContain("2 小时"); // 120min 中文
    expect(text).not.toMatch(/[hm]\b/);
    h.cleanup();
  });
});

describe("AnalyticsSummaryStripSkeleton", () => {
  it("loading 骨架与最终布局同 testid/四格", () => {
    const h = render(<AnalyticsSummaryStripSkeleton />);
    const strip = h.container.querySelector('[data-testid="analytics-summary-strip"]');
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll("[aria-label='学习指标加载中']")).toHaveLength(0);
    h.cleanup();
  });
});
