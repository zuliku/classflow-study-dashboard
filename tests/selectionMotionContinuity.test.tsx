// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useKiroSessionActions: () => ({
    handoffPrompt: vi.fn(),
    handoffAssignmentPrompt: vi.fn(),
    claimEmptyIntro: vi.fn(),
    openSidecar: vi.fn(),
    closeSidecar: vi.fn(),
    expandSidecar: vi.fn(),
    minimizeSidecar: vi.fn(),
    restoreSidecar: vi.fn(),
  }),
}));

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

const mediaState = { reduceMatches: false };
async function readSrc(p: string) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
}

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? mediaState.reduceMatches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AnalyticsRangeSelector } from "@/components/analytics/AnalyticsRangeSelector";
import { StudyOutlookCard } from "@/components/analytics/StudyOutlookCard";
import type { StudyOutlook, StudyOutlookHorizon } from "@/lib/outlook/types";

/**
 * Workflow UX Motion M3 —— Selection Continuity：
 * - SegmentedControl plate：--motion-base / --ease-selection；--motion-select orphan token 已收口
 * - programmatic value change → plate 跟随（无 imperative animation）
 * - AnalyticsRangeSelector 与 StudyOutlook horizon 均收敛到 SegmentedControl
 */

function renderSeg(value: string, onChange = vi.fn()) {
  render(
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel="选择"
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />
  );
  return onChange;
}

afterEach(() => {
  cleanup();
});

describe("SegmentedControl selection motion", () => {
  it("plate 使用 --motion-base + --ease-selection（transform,width）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/ui/SegmentedControl.tsx"), "utf-8");
    expect(src).toContain("transition-[transform,width] ease-[var(--ease-selection)]");
    expect(src).toContain("duration-[var(--motion-base)]");
    expect(src).not.toContain("var(--motion-select)");
  });

  it("--motion-select orphan token 已从 globals.css 删除", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf-8");
    expect(css).not.toContain("--motion-select");
  });

  it("programmatic value change → aria-pressed 跟随 + plate 保持 motion contract", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl
        value="a"
        onChange={onChange}
        ariaLabel="选择"
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
      />
    );
    expect(screen.getByRole("button", { name: "A" }).getAttribute("aria-pressed")).toBe("true");
    // jsdom 无布局（offsetLeft/Width = 0）→ transform 数值不可断言；
    // 程序化变更的契约 = 语义状态立即跟随 + plate 节点持续存在并以 base/selection 运动
    rerender(
      <SegmentedControl
        value="b"
        onChange={onChange}
        ariaLabel="选择"
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
      />
    );
    expect(screen.getByRole("button", { name: "B" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "A" }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".duration-\\[var\\(--motion-base\\)\\]")).toBeTruthy();
  });

  it("Reduced Motion → duration-0 直接定位", async () => {
    mediaState.reduceMatches = true; // prefers-reduced-motion: reduce → effective reduced
    const { SegmentedControl: ReducedSC } = await import("@/components/ui/SegmentedControl");
    render(
      <ReducedSC
        value="a"
        onChange={() => {}}
        ariaLabel="选择"
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
      />
    );
    expect(document.querySelector(".duration-0")).toBeTruthy();
    mediaState.reduceMatches = false;
  });

  it("option press feedback：active opacity + snap（空间控件不 scale）", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync(require("node:path").join(process.cwd(), "components/ui/SegmentedControl.tsx"), "utf-8")
    );
    expect(src).toContain("active:opacity-[0.78]");
    expect(src).toContain("active:duration-[var(--motion-snap)]");
    expect(src.match(/option[^]*?scale\(/)).toBeNull();
  });
});

// ============================================================
// 消费者迁移契约
// ============================================================
describe("Selection consumers migration", () => {
  it("AnalyticsRangeSelector 使用共享 SegmentedControl（preset 不变）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/analytics/AnalyticsRangeSelector.tsx"), "utf-8");
    expect(src).toContain("SegmentedControl<AnalyticsRangePreset>");
    expect(src).toContain('label: PRESET_LABELS.week');
    expect(src).not.toMatch(/aria-pressed/); // 手写三 button 已移除
  });

  it("StudyOutlook horizon 使用 SegmentedControl size=xs（7 / 14）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/analytics/StudyOutlookCard.tsx"), "utf-8");
    expect(src).toContain("SegmentedControl<StudyOutlookHorizon>");
    expect(src).toContain('size="xs"');
    expect(src).toContain("未来 ${h} 天");
  });

  it("size=xs 渲染 compact option class（px-2 py-0.5 text-[10px]）", () => {
    render(
      <SegmentedControl
        value={7}
        onChange={() => {}}
        ariaLabel="范围"
        size="xs"
        options={[
          { value: 7, label: "未来 7 天" },
          { value: 14, label: "未来 14 天" },
        ]}
      />
    );
    const opt = screen.getByRole("button", { name: "未来 7 天" });
    expect(opt.className).toContain("px-2");
    expect(opt.className).toContain("py-0.5");
    expect(opt.className).toContain("text-[10px]");
  });
});

// StudyOutlookCard 冒烟（horizon props 形状）
const outlookFixture = {
  summary: {
    counts: { totalDue: 0, atRisk: 0, attention: 0, missingEstimate: 0 },
    workload: { preferredShortfallMinutes: 0, combinedShortfallMinutes: 0, remainingKnownMinutes: 0 },
  },
  tasks: [],
  bottleneckDays: [],
  firstCapacityShortfall: null,
} as unknown as Parameters<typeof StudyOutlookCard>[0]["outlook"];

describe("StudyOutlookCard horizon smoke", () => {
  it("渲染两个 horizon option 且当前值 aria-pressed", () => {
    render(
      <StudyOutlookCard
        outlook={outlookFixture}
        horizonDays={14}
        onHorizonChange={() => {}}
        onOpenAssignment={() => {}}
      />
    );
    const b14 = screen.getByRole("button", { name: "未来 14 天" });
    expect(b14.getAttribute("aria-pressed")).toBe("true");
    void (outlookFixture as unknown as StudyOutlook);
    void ({} as StudyOutlookHorizon);
  });
});

// ============================================================
// Workflow UX Motion M3 —— Timeline week motion cleanup（static contract）
// ============================================================
describe("Timeline week motion cleanup", () => {
  it("不再使用 offsetWidth 强制 reflow / classList 重播 ux-week-enter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/timeline/TimelineWorkspace.tsx"), "utf-8");
    expect(src).not.toContain('void el.offsetWidth');
    expect(src).not.toContain('classList.remove("ux-week-enter")');
    expect(src).not.toContain('classList.add("ux-week-enter")');
  });

  it("nonce parity 控制 animation variant；方向变量由 JSX 注入", async () => {
    const src = await readSrc("components/timeline/TimelineWorkspace.tsx");
    expect(src).toContain("weekMotion.nonce % 2 === 0 ? \"ux-week-enter-a\" : \"ux-week-enter-b\"");
    expect(src).toContain('"--motion-shift-y":');
    expect(src).toContain('weekMotion.shift === "prev" ? "-6px" : "6px"');
  });

  it("CSS：a/b 等价 keyframes 成对存在；旧单类与单 keyframes 已替换", async () => {
    const css = await readCss("app/globals.css");
    expect(css).toContain(".ux-week-enter-a {");
    expect(css).toContain(".ux-week-enter-b {");
    expect(css).toContain("@keyframes ux-week-in-a {");
    expect(css).toContain("@keyframes ux-week-in-b {");
    expect(css).not.toMatch(/\.ux-week-enter \{/);
    expect(css).not.toContain("@keyframes ux-week-in {");
  });

  it("首帧（weekMotion null）不附加 enter 类", async () => {
    const src = await readSrc("components/timeline/TimelineWorkspace.tsx");
    expect(src).toMatch(/weekMotion &&\s*\(weekMotion\.nonce % 2/);
  });

  async function readCss(p: string) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
  }
});
