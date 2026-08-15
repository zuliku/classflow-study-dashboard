import { describe, it, expect } from "vitest";
import { resolveDrawerAriaModal, resolveDrawerPresentation } from "@/components/ui/Drawer";

/**
 * Drawer primitive 回归护栏（Task/DDL Detail Panel UX Refresh）：
 * 1. 默认 edge presentation 的 class 契约完全不变（CourseDrawer 等 consumer 视觉零回归）
 * 2. floating presentation 是有界浮层（viewport inset + 470px + rounded + full border）
 * 3. aria-modal 与 presentation 一致：edge=true（现状）；floating 不冒充 modal
 */
describe("Drawer presentation class contract", () => {
  it("edge（默认）：overlay + panel class 与重构前完全一致", () => {
    const enter = resolveDrawerPresentation("edge", true);
    expect(enter.overlayClassName).toBe(
      "fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-end overflow-hidden"
    );
    expect(enter.panelClassName).toContain("h-full w-full bg-surface shadow-drawer border-l border-line");
    expect(enter.panelClassName).toContain("translate-x-0 opacity-100");

    const exit = resolveDrawerPresentation("edge", false);
    expect(exit.panelClassName).toContain("translate-x-3 opacity-0");
    // 无 floating 专属类
    expect(exit.panelClassName).not.toContain("rounded-2xl");
    expect(exit.panelClassName).not.toContain("shadow-card");
  });

  it("floating：viewport inset + 470px + max-height + rounded + full border + shadow", () => {
    const enter = resolveDrawerPresentation("floating", true);
    // overlay 提供 16px(桌面)/12px(移动) inset
    expect(enter.overlayClassName).toContain("p-3");
    expect(enter.overlayClassName).toContain("sm:p-4");
    // 背景不更深于 edge（柔和遮罩）
    expect(enter.overlayClassName).toContain("bg-black/20");
    // 非阻塞浮层：backdrop 透传指针（面板打开时可点击其他任务 → 内容就地切换）
    expect(enter.overlayClassName).toContain("pointer-events-none");
    expect(enter.panelClassName).toContain("pointer-events-auto");
    // 面板：有界几何
    expect(enter.panelClassName).toContain("sm:w-[470px]");
    expect(enter.panelClassName).toContain("max-h-[calc(100dvh-24px)]");
    expect(enter.panelClassName).toContain("sm:max-h-[calc(100dvh-32px)]");
    expect(enter.panelClassName).toContain("rounded-2xl");
    expect(enter.panelClassName).toContain("border-line-strong");
    expect(enter.panelClassName).toContain("shadow-card");
    expect(enter.panelClassName).toContain("flex flex-col overflow-hidden");
    // enter 运动：位移 + 微缩放 + 淡入
    expect(enter.panelClassName).toContain("translate-x-0 scale-100 opacity-100");
    // 无 edge 的 border-l-only 形态
    expect(enter.panelClassName).not.toContain("shadow-drawer");
    expect(enter.panelClassName).not.toMatch(/\bborder-l\b/);
  });

  it("floating exit：更快（160ms）且位移方向保持右侧来源感", () => {
    const exit = resolveDrawerPresentation("floating", false);
    expect(exit.panelClassName).toContain("translate-x-4 scale-[.994] opacity-0");
    expect(exit.panelClassName).toContain("!duration-[160ms]");
  });

  it("floating enter 时长为 230ms（emphasized easing）", () => {
    const enter = resolveDrawerPresentation("floating", true);
    expect(enter.panelClassName).toContain("!duration-[230ms]");
    expect(enter.panelClassName).toContain("ease-[var(--ease-emphasized)]");
  });

  it("aria-modal 与 presentation 一致：edge=true（保持现状）；floating 不声明（不冒充 modal）", () => {
    expect(resolveDrawerAriaModal("edge")).toBe("true");
    expect(resolveDrawerAriaModal("floating")).toBeUndefined();
  });
});
