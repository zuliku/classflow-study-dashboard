import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Learning Analytics open motion contract", () => {
  it("页面 stage 统一进入，不再让 top grid 逐块 stagger", () => {
    const view = read("components/analytics/LearningAnalyticsView.tsx");
    expect(view).toContain("ux-analytics-enter");
    expect(view).not.toContain("staggerStyle");
    expect(view).not.toContain("staggerFirstData");
  });

  it("Coverage notice 首帧占最终布局高度：不做 0fr 高度展开", () => {
    const notice = read("components/analytics/AnalyticsCoverageNotice.tsx");
    expect(notice).not.toMatch(/import[^;]*ExitCollapse|<ExitCollapse/);
    expect(notice).not.toMatch(/usePresence\(/);
    expect(notice).not.toContain("grid-rows");
  });

  it("动量卡 loading skeleton 与最终 card 同构，避免异步晚到撑高 top grid", () => {
    const momentum = read("components/analytics/AnalyticsMomentum.tsx");
    expect(momentum).toContain("analytics-momentum-skeleton");
    expect(momentum).toContain("MomentumCardSkeleton");
    expect(momentum).toContain("ux-fade flex flex-1 flex-col gap-4");
  });

  it("有旧数据刷新时不闪回整页骨架", () => {
    const view = read("components/analytics/LearningAnalyticsView.tsx");
    expect(view).toContain("const refreshing = loading && !!data");
    expect(view).toContain('loading && !data ? "loading"');
    expect(view).toContain("ux-analytics-enter");
    const momentum = read("components/analytics/AnalyticsMomentum.tsx");
    expect(momentum).toContain("const refreshing = loading && !!data");
    expect(momentum).toContain(") : !data ? (");
  });

  it("全局 token 驱动，不写裸 duration", () => {
    const css = read("app/globals.css");
    expect(css).toContain("@keyframes ux-analytics-enter");
    expect(css).toMatch(/\.ux-analytics-enter\s*\{[^}]*var\(--motion-base\)[^}]*var\(--ease-standard\)/s);
  });
});
