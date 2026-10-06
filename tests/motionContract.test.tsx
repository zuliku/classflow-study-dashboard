// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

// matchMedia polyfill（jsdom 无；useEffectiveReducedMotion 依赖）
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

import { MOTION_MS, MOTION_EXIT_MS, EASE, KIRO_MOTION_MS, KIRO_MOTION_SIDECAR_MS, STAGGER_MS } from "@/lib/motion";
import { usePresence } from "@/lib/usePresence";
import { useAppStore } from "@/store/useAppStore";

/**
 * Motion Foundation V2 Contract 测试：
 * 一种交互语义只存在一个 Motion 时间真值 ——
 * 1. CSS token（globals.css）↔ JS 常量（lib/motion.ts）数值一致
 * 2. Primitive 不再出现裸魔法 duration / exit timer 分裂
 * 3. presence lifecycle：open → mounted hidden → visible → close → hidden → duration 后 unmount
 * 4. Reduced Motion：不等待 exit timer，立即落最终态
 * 5. Motion V3：easing 进出不对称（进入 standard，退出 exit 加速离场）
 */

function setMotionPreference(pref: "system" | "full" | "reduced") {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({ preferences: { ...prefs, motionPreference: pref } });
}

/** 双 rAF 推进（usePresence 的 first-frame transition 依赖两帧） */
function advanceTwoFrames() {
  act(() => {
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(16);
  });
}

function PresenceProbe({ open, duration }: { open: boolean; duration: number }) {
  const { mounted, visible } = usePresence(open, duration);
  return (
    <div data-testid="probe" data-mounted={String(mounted)} data-visible={String(visible)} />
  );
}

describe("Motion Contract：CSS token ↔ JS 常量一致", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

  it.each([
    ["snap", "--motion-snap"],
    ["fast", "--motion-fast"],
    ["base", "--motion-base"],
    ["overlay", "--motion-overlay"],
    ["panel", "--motion-panel"],
    ["page", "--motion-page"],
    ["data", "--motion-data"],
  ] as const)("MOTION_MS.%s = %s 数值一致", (tier, cssVar) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${MOTION_MS[tier]}ms`));
  });

  it.each([
    ["fast", "--motion-exit-fast"],
    ["base", "--motion-exit-base"],
    ["panel", "--motion-exit-panel"],
  ] as const)("MOTION_EXIT_MS.%s = %s 数值一致", (tier, cssVar) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${MOTION_EXIT_MS[tier]}ms`));
  });

  it("exit ≈ enter 的 70–80%（语义阶梯）", () => {
    expect(MOTION_EXIT_MS.fast).toBeGreaterThanOrEqual(MOTION_MS.fast * 0.7);
    expect(MOTION_EXIT_MS.fast).toBeLessThanOrEqual(MOTION_MS.fast * 0.85);
    expect(MOTION_EXIT_MS.base).toBeGreaterThanOrEqual(MOTION_MS.base * 0.7);
    expect(MOTION_EXIT_MS.base).toBeLessThan(MOTION_MS.base);
    expect(MOTION_EXIT_MS.panel).toBeLessThan(MOTION_MS.overlay);
  });

  it("Motion V3 easing：CSS token ↔ JS EASE 一一对应", () => {
    expect(css).toMatch(/--ease-standard:\s*cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\)/);
    expect(css).toMatch(/--ease-emphasized:\s*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    expect(css).toMatch(/--ease-enter:\s*cubic-bezier\(0,\s*0,\s*0\.2,\s*1\)/);
    expect(css).toMatch(/--ease-exit:\s*cubic-bezier\(0\.3,\s*0,\s*1,\s*1\)/);
    expect(css).toMatch(/--ease-spring:\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/);
    expect(EASE.standard).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(EASE.emphasized).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(EASE.enter).toBe("cubic-bezier(0, 0, 0.2, 1)");
    expect(EASE.exit).toBe("cubic-bezier(0.3, 0, 1, 1)");
    expect(EASE.spring).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  });

  it("Motion V3：退出分支统一加速离场（--ease-exit），进入保持 standard", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    for (const f of [
      "components/ui/Dialog.tsx",
      "components/ui/Drawer.tsx",
      "components/ui/Popover.tsx",
      "components/ui/DisclosureRegion.tsx",
      "components/ui/OverlayLayer.tsx",
      "components/ui/ToastViewport.tsx",
    ]) {
      expect(read(f)).toMatch(/ease-\[var\(--ease-exit\)\]/);
    }
    expect(read("components/ui/Dialog.tsx")).toMatch(/ease-\[var\(--ease-standard\)\]/);
  });

  it("Motion V3 P1：staged/skeleton 工具 + reduced 守卫", () => {
    expect(css).toMatch(/\.ux-staged-s0/);
    expect(css).toMatch(/\.ux-staged-s1/);
    expect(css).toMatch(/\.ux-staged-s2/);
    expect(css).toMatch(/\.ux-staged-s3/);
    expect(css).toMatch(/animation-delay:\s*var\(--kiro-stagger-0/);
    expect(css).toMatch(/@keyframes ux-staged-in/);
    expect(css).toMatch(/\.ux-skeleton/);
    expect(css).toMatch(/@keyframes ux-skeleton-sweep/);
    // ux-shared-detail（View Transitions 占位）已删除：零调用，留着是治理剧场
    expect(css).not.toContain(".ux-shared-detail");
    // reduced-motion 下 staged 延迟清零 + skeleton 扫光关闭（双通道：media + effective）
    expect(css).toMatch(/\.ux-staged-s0,\s*\n?\s*html[^\{]*\.ux-staged-s3\s*\{[^}]*animation-delay:\s*0ms/s);
    expect(css).toMatch(/\.ux-skeleton::after\s*\{[^}]*display:\s*none/s);
  });

  it("Motion V3 P1：Overview 首屏编排 + skeleton 渐进增强（无裸 pulse 替换）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const overview = read("components/dashboard/OverviewWorkspace.tsx");
    expect(overview).toMatch(/ux-staged-s0/);
    expect(overview).toMatch(/ux-staged-s1/);
    expect(overview).toMatch(/ux-staged-s2/);
    // skeleton 保留 animate-pulse 占位语义，只叠加 ux-skeleton 扫光
    expect(read("components/analytics/AnalyticsSummaryStrip.tsx")).toMatch(/ux-skeleton/);
    expect(read("components/analytics/AnalyticsSummaryStrip.tsx")).toMatch(/animate-pulse/);
  });

  it("Motion V3 P2：Sidebar width morph 走 spring（时长不变，仅曲线）", () => {
    expect(css).toMatch(/\.sidebar-shell\s*\{[^}]*transition-timing-function:\s*var\(--ease-spring\)/s);
  });

  it("P1 空间位移 spring 化：Navigator shell + Sidecar 进入走 spring，退出仍加速", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const navigator = read("components/kiro/navigation/KiroNavigator.tsx");
    expect(navigator).toMatch(/transition-\[width\][\s\S]{0,120}?ease-\[var\(--ease-spring\)\]/);
    const sidecar = read("components/kiro/sidecar/KiroSidecarShell.tsx");
    expect(sidecar).toMatch(/duration-\[var\(--motion-panel\)\] ease-\[var\(--ease-spring\)\]/);
    expect(sidecar).toMatch(/duration-\[var\(--motion-exit-panel\)\] ease-\[var\(--ease-exit\)\]/);
  });

  it("P0 一致性收口 D1：Kiro 域退出分支统一加速离场（--ease-exit）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    for (const f of [
      "components/kiro/sidecar/KiroSidecarShell.tsx",
      "components/kiro/navigation/KiroNavigator.tsx",
      "components/kiro/KiroContextPicker.tsx",
      "components/kiro/KiroHistoryPanel.tsx",
      "components/kiro/inspector/KiroInspector.tsx",
      "components/reminders/ReminderCenter.tsx",
    ]) {
      expect(read(f)).toMatch(/ease-\[var\(--ease-exit\)\]/);
    }
  });

  it("P0 一致性收口 D2：提醒卡片进退场对齐 Toast 模式", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/reminders/ReminderViewport.tsx"),
      "utf8"
    );
    expect(src).toContain("ux-toast-enter");
    // 退出计时走 exit 常量（此前误用 enter 档 MOTION_MS.fast，已收敛）
    expect(src).toContain("MOTION_EXIT_MS.fast");
    expect(src).not.toContain("MOTION_MS.fast");
    expect(src).toContain("!duration-[var(--motion-exit-fast)]");
    expect(src).toMatch(/exiting[\s\S]{0,200}?opacity-0/);
  });

  it("P0 一致性收口 D3：骨架扫光覆盖全部 pulse 占位（渐进增强，不替换）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    for (const f of [
      "components/history/EntityActivitySection.tsx",
      "components/kiro/KiroMarkdown.tsx",
      "components/kiro/KiroMermaid.tsx",
      "components/kiro/KiroMessage.tsx",
    ]) {
      expect(read(f)).toMatch(/ux-skeleton/);
    }
    // pulse 占位语义保留（扫光只是叠加层）
    expect(read("components/kiro/KiroMessage.tsx")).toMatch(/animate-pulse/);
  });

  it("Motion V3 收尾：Gallery/fps dev 门禁 + 松手零投射 + token-only（无裸时长旁路）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    // dev-only 门禁（production 永不渲染）
    expect(read("components/motion/MotionGallery.tsx")).toMatch(/isMotionDev/);
    expect(read("components/motion/MotionFpsProbe.tsx")).toMatch(/isMotionDev/);
    expect(read("lib/motionDev.ts")).toMatch(/NODE_ENV === "development"/);
    // Gallery 只引用 token（时长/easing 经 var() 或 Contract 常量，无 duration-[Nms]）
    expect(read("components/motion/MotionGallery.tsx")).not.toMatch(/duration-\[\d+ms\]/);
    expect(read("components/motion/MotionGallery.tsx")).toMatch(/duration-\[var\(--motion-/);
    // 松手零投射（惯性投射已下线：曾按松手速度瞬移 ≤200px 再 clamp，
    // 普通速度松手即触发、视觉即“边角吸附”；落位 = 手指位置，确定性）。
    // Shell 不得再引用投射路径；投射模块已删除（死代码不保留）。
    const shell = read("components/kiro/sidecar/KiroSidecarShell.tsx");
    expect(shell).not.toMatch(/projectFlingPosition/);
    expect(shell).not.toMatch(/FLING_MIN_SAMPLES/);
    expect(shell).not.toMatch(/sidecarFling/);
    expect(fs.existsSync(path.join(process.cwd(), "lib/ai/ui/sidecarFling.ts"))).toBe(false);
    expect(shell).not.toMatch(/setTimeout\(.*fling/i);
  });

  it.each([
    ["control", "--kiro-motion-control", KIRO_MOTION_MS.control],
    ["structure", "--kiro-motion-structure", KIRO_MOTION_MS.structure],
    ["spatial", "--kiro-motion-spatial", KIRO_MOTION_MS.spatial],
    ["popoverEnter", "--kiro-motion-popover-enter", KIRO_MOTION_MS.popoverEnter],
    ["popoverExit", "--kiro-motion-popover-exit", KIRO_MOTION_MS.popoverExit],
    ["intro", "--kiro-motion-intro", KIRO_MOTION_MS.intro],
    ["composerIntro", "--kiro-motion-composer-intro", KIRO_MOTION_MS.composerIntro],
  ] as const)("S3-1 KIRO_MOTION_MS.%s = :root %s (%sms)", (tier, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value}ms`));
  });

  it.each([
    ["control", 100],
    ["structure", 130],
    ["spatial", 180],
    ["popoverEnter", 120],
    ["popoverExit", 100],
    ["intro", 250],
    ["composerIntro", 130],
  ] as const)("S3-1 sidecar scope 更快：KIRO_MOTION_SIDECAR_MS.%s = %sms", (tier, value) => {
    expect(KIRO_MOTION_SIDECAR_MS[tier]).toBe(value);
    expect(css).toMatch(new RegExp(`\\.kiro-motion-sidecar\\s*\\{[^}]*${value}ms`, "s"));
  });

  it("S3-2 Inspector presence 窗口 = spatial（退出不截断 width morph）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const inspector = read("components/kiro/inspector/KiroInspector.tsx");
    expect(inspector).toContain("KIRO_MOTION_MS.spatial");
    expect(inspector).not.toContain("MOTION_EXIT_MS.panel");
  });

  it.each([
    ["s0", "--kiro-stagger-0", STAGGER_MS.s0],
    ["s1", "--kiro-stagger-1", STAGGER_MS.s1],
    ["s2", "--kiro-stagger-2", STAGGER_MS.s2],
    ["s3", "--kiro-stagger-3", STAGGER_MS.s3],
    ["empty1", "--kiro-stagger-empty-1", STAGGER_MS.empty1],
    ["empty2", "--kiro-stagger-empty-2", STAGGER_MS.empty2],
    ["emptyBase", "--kiro-stagger-empty-base", STAGGER_MS.emptyBase],
    ["emptyStep", "--kiro-stagger-empty-step", STAGGER_MS.emptyStep],
    ["mentionStep", "--kiro-stagger-mention-step", STAGGER_MS.mentionStep],
  ] as const)("S3-3 STAGGER_MS.%s = :root %s (%sms)", (tier, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value}ms`));
  });
  it("S3-3 调用方 stagger 经 token 引用（无裸 delay-[Nms]）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    // S5：遗留双入口（Rail/Panel）已删除，只剩现役 Navigator
    for (const f of ["components/kiro/navigation/KiroNavigator.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/delay-\[\d+ms\]/);
      expect(src).toMatch(/delay-\[var\(--kiro-stagger-/);
    }
    // Empty intro：CSS 侧经 token（60/110/base+index*step）
    expect(css).toMatch(/animation-delay:\s*var\(--kiro-stagger-empty-1/);
    expect(css).toMatch(/animation-delay:\s*var\(--kiro-stagger-empty-2/);
    expect(css).toMatch(/var\(--kiro-stagger-empty-base[^)]*\)\s*\+\s*var\(--kiro-stagger-index[^)]*\)\s*\*\s*var\(--kiro-stagger-empty-step/);
  });

  it("S3-3 常驻 infinite 全部收归 token（breathe + Rail 品牌态，不扩散）", () => {
    expect(css).toMatch(/--kiro-ambient-breathe:\s*3\.2s/);
    expect(css).toMatch(/animation:\s*kiro-now-course-breathe\s+var\(--kiro-ambient-breathe/);
    // 每条常驻 infinite 必须引用治理中的 token/时长：ambient-breathe、flow 三档、
    // computer ring、reasoning flow、thinking pulse 2.1s、skeleton sweep —— 新增常驻动画会触发本测试
    const infiniteLines = css
      .split("\n")
      .filter((l) => l.includes("infinite") && l.includes("animation:"));
    expect(infiniteLines.length).toBeGreaterThan(0);
    for (const line of infiniteLines) {
      expect(line).toMatch(
        /var\(--kiro-(ambient-breathe|flow-ambient|flow-active|flow-working|computer-ring-duration|reasoning-flow)\)?|kiro-rail-thinking-pulse 2\.1s|var\(--skeleton-sweep/
      );
    }
  });

  it("S3-3 pulse/spin 用 Tailwind 默认档（无任意动画、无 bounce/ping）", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-n", "-E", "animate-\\[|animate-(bounce|ping)", "--", "components", "app", "src", "lib"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }) as string;
    } catch (e) {
      // git grep 无命中时 exit 1：stdout 为空即通过
      const stdout = (e as { stdout?: unknown }).stdout;
      out = typeof stdout === "string" ? stdout : Buffer.isBuffer(stdout) ? stdout.toString("utf8") : "";
    }
    expect(out.trim()).toBe("");
  });

  it("S3-3 Popover kiro presence 为上界（≥ 任一 scope 视觉退出，不截断）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const popover = read("components/ui/Popover.tsx");
    // kiro=160 ≥ workspace exit 120 且 ≥ sidecar exit 100（注释已说明上界语义）
    expect(popover).toMatch(/motionProfile === "kiro" \? 160/);
    expect(KIRO_MOTION_MS.popoverExit).toBeLessThanOrEqual(160);
    expect(KIRO_MOTION_SIDECAR_MS.popoverExit).toBeLessThanOrEqual(160);
  });

  it("Primitive 层不再散落裸魔法 exit duration（源码护栏）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    // Dialog：CSS exit var 与 presence 常量同源
    const dialog = read("components/ui/Dialog.tsx");
    expect(dialog).toContain("MOTION_EXIT_MS.base");
    expect(dialog).toContain("!duration-[var(--motion-exit-base)]");
    expect(dialog).not.toMatch(/exitMs = \d/);
    // Drawer：两种 presentation 共用同一 exit var + panel 常量
    const drawer = read("components/ui/Drawer.tsx");
    expect(drawer).toContain("MOTION_EXIT_MS.panel");
    expect(drawer).toContain("!duration-[var(--motion-exit-panel)]");
    expect(drawer).toMatch(/!duration-\[var\(--motion-overlay\)\]/g);
    // PopoverPanel：default profile 走 fast 档
    const popover = read("components/ui/Popover.tsx");
    expect(popover).toContain("MOTION_EXIT_MS.fast");
    expect(popover).toContain("!duration-[var(--motion-exit-fast)]");
    // DisclosureRegion：enter=base / close=exit-base / presence 同源
    const disclosure = read("components/ui/DisclosureRegion.tsx");
    expect(disclosure).toContain("MOTION_EXIT_MS.base");
    expect(disclosure).toContain("duration-[var(--motion-base)]");
    expect(disclosure).toContain("!duration-[var(--motion-exit-base)]");
    // ExitCollapse ↔ useExitPresenceList 同一常量
    const exitCollapse = read("components/ui/ExitCollapse.tsx");
    expect(exitCollapse).toContain("duration-[var(--motion-exit-panel)]");
    const listHook = read("lib/useExitPresenceList.ts");
    expect(listHook).toContain("MOTION_EXIT_MS.panel");
    // useEnterOnAdd ↔ animate-enter（--motion-base）同一档位
    const enterOnAdd = read("lib/useEnterOnAdd.ts");
    expect(enterOnAdd).toContain("MOTION_MS.base");
    // ToastViewport：EXIT_MS 与退出视觉（--motion-exit-fast）同源，与 Reminder 同档
    const toast = read("components/ui/ToastViewport.tsx");
    expect(toast).toContain("EXIT_MS = MOTION_EXIT_MS.fast");
    expect(toast).toContain("!duration-[var(--motion-exit-fast)]");
    // Select：共享 usePresence，不再自维护 close timer / rAF
    const select = read("components/ui/Select.tsx");
    expect(select).toContain("usePresence(open, MOTION_EXIT_MS.fast)");
    expect(select).not.toContain("closeTimerRef");
    expect(select).not.toContain("rafRef");
  });
});

describe("usePresence lifecycle contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMotionPreference("full");
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    setMotionPreference("system");
  });

  it("normal motion：open → mounted hidden → 两帧后 visible → close → hidden → duration 后 unmount", () => {
    const { getByTestId, rerender } = render(<PresenceProbe open={false} duration={MOTION_EXIT_MS.panel} />);
    expect(getByTestId("probe").dataset.mounted).toBe("false");

    rerender(<PresenceProbe open={true} duration={MOTION_EXIT_MS.panel} />);
    // 先挂载隐藏（触发进入过渡的起点）
    expect(getByTestId("probe").dataset.mounted).toBe("true");
    expect(getByTestId("probe").dataset.visible).toBe("false");

    advanceTwoFrames();
    expect(getByTestId("probe").dataset.visible).toBe("true");

    rerender(<PresenceProbe open={false} duration={MOTION_EXIT_MS.panel} />);
    // 立即不可见，但仍在 DOM（退出动画播放中）
    expect(getByTestId("probe").dataset.visible).toBe("false");
    expect(getByTestId("probe").dataset.mounted).toBe("true");

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel - 1);
    });
    expect(getByTestId("probe").dataset.mounted).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId("probe").dataset.mounted).toBe("false");
  });

  it("reduced motion：不等待 exit timer，open/close 均即时落最终态", () => {
    setMotionPreference("reduced");
    const { getByTestId, rerender } = render(<PresenceProbe open={false} duration={MOTION_EXIT_MS.panel} />);
    expect(getByTestId("probe").dataset.mounted).toBe("false");

    rerender(<PresenceProbe open={true} duration={MOTION_EXIT_MS.panel} />);
    expect(getByTestId("probe").dataset.mounted).toBe("true");
    // 无双 rAF 等待
    expect(getByTestId("probe").dataset.visible).toBe("true");

    rerender(<PresenceProbe open={false} duration={MOTION_EXIT_MS.panel} />);
    // 关闭即卸载，不空等 timer
    expect(getByTestId("probe").dataset.mounted).toBe("false");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getByTestId("probe").dataset.mounted).toBe("false");
  });

  it("close 后立刻重开：取消 pending unmount，重新进入", () => {
    const { getByTestId, rerender } = render(<PresenceProbe open={true} duration={MOTION_EXIT_MS.panel} />);
    advanceTwoFrames();
    rerender(<PresenceProbe open={false} duration={MOTION_EXIT_MS.panel} />);
    rerender(<PresenceProbe open={true} duration={MOTION_EXIT_MS.panel} />);
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel * 2);
    });
    // 若未取消 exit timer，mounted 会中途翻 false
    expect(getByTestId("probe").dataset.mounted).toBe("true");
    expect(getByTestId("probe").dataset.visible).toBe("true");
  });
});

describe("Composer 动效升级 P1-P3：对称进退源码契约", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("菜单/拖拽/附件架走 usePresence + Contract exit 常量（无魔法数字）", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    for (const snippet of [
      "usePresence(slashOpen, MOTION_EXIT_MS.fast)",
      "usePresence(mentionOpen, MOTION_EXIT_MS.fast)",
      "usePresence(dragOver, MOTION_EXIT_MS.fast)",
      // 附件架 presence 与 ExitCollapse 纵向折叠同源（panel），卸载不截断；其余提示条走 fast
      // 删最后一张卡时盒子与 chip 并行收：open 判定排除 leaving（落库与卸载同 tick）
      "attachments.some((a) => !leavingAttachmentIds.has(a.id))",
    ]) {
      expect(composer).toContain(snippet);
    }
    // 退出分支统一加速离场 + exit-fast var（进入保持既有 keyframe）
    for (const snippet of ["duration-[var(--motion-exit-fast)]", "ease-[var(--ease-exit)]"]) {
      expect(composer).toContain(snippet);
    }
    expect(composer).not.toMatch(/duration-\[\d+ms\]/);
  });

  it("附件/Context chip 原位退出：leaving 态 + ExitCollapse 横向（无魔法数字）", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    expect(composer).toContain("leavingAttachmentIds");
    expect(composer).toContain("MOTION_EXIT_MS.panel");
    expect(composer).toContain('axis="horizontal"');
    expect(composer).not.toMatch(/setTimeout\(\s*\d/);
    const bar = read("components/kiro/KiroContextBar.tsx");
    expect(bar).toContain("leavingKeys");
    expect(bar).toContain("MOTION_EXIT_MS.panel");
    expect(bar).toContain('axis="horizontal"');
    const collapse = read("components/ui/ExitCollapse.tsx");
    expect(collapse).toContain("grid-cols-[0fr]");
    expect(collapse).toContain("duration-[var(--motion-exit-panel)]");
  });

  it("P2/P3：textarea 高度直写无过渡 + 发送 press 均走 token/常量", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    // autoGrow 每键直写 height：禁止 height 过渡（否则排队插值滞后/回弹），等高由 min-h 保证
    expect(composer).not.toContain("transition-[height]");
    expect(composer).toContain('min-h-[44px]');
    expect(composer).toContain('min-h-[64px]');
    expect(composer).toContain("duration-[var(--kiro-motion-control,var(--motion-fast))]");
    expect(composer).toContain("MOTION_MS.snap");
    expect(read("app/globals.css")).toContain(
      "transition: box-shadow var(--kiro-motion-control, var(--motion-fast)) var(--ease-standard)"
    );
  });

  it("＋菜单常挂载受控（外层硬条件会截断 PopoverPanel 退出）", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    expect(composer).toContain('open={openMenu === "add"}');
    expect(composer).not.toMatch(/\{\s*openMenu === "add" && \(\s*<PopoverPanel/);
  });

  it("建议条进退场 + 审批条进入 + 发送钮透明度过渡", () => {
    const suggestions = read("components/kiro/KiroContextSuggestions.tsx");
    expect(suggestions).toContain("usePresence(open, MOTION_EXIT_MS.panel)");
    expect(suggestions).toContain("ExitCollapse");
    expect(suggestions).toContain("animate-enter");
    const approval = read("components/kiro/run/KiroInlineApproval.tsx");
    expect(approval).toContain("animate-enter");
    const send = read("components/kiro/KiroSendControl.tsx");
    expect(send).toContain("transition-[opacity,background-color]");
    expect(send).toContain("duration-[var(--kiro-motion-control,var(--motion-fast))]");
  });

  it("深度排查 Batch1：Kiro 消息/会话/导航/历史/检查器对称进退", () => {
    const message = read("components/kiro/KiroMessage.tsx");
    expect(message).toContain("usePresence(showStreamingCursor === true, MOTION_EXIT_MS.fast)");
    expect(message).toContain("animate-enter");
    const surface = read("components/kiro/computer/session/KiroComputerSessionSurface.tsx");
    expect(surface).toContain("animate-enter");
    const navigator = read("components/kiro/navigation/KiroNavigator.tsx");
    expect(navigator).toContain("KIRO_MOTION_MS.popoverExit");
    expect(navigator).not.toContain("MOTION_MS.overlay");
    const inspector = read("components/kiro/inspector/KiroInspector.tsx");
    expect(inspector).toContain("duration-[var(--motion-exit-panel)]");
    expect(inspector).toContain("ease-[var(--ease-exit)]");
    const thread = read("components/kiro/KiroThreadRow.tsx");
    expect(thread).toContain("KiroMenuPanel");
    expect(thread).toContain('open={menuOpen}');
    const history = read("components/kiro/KiroHistoryPanel.tsx");
    expect(history).toContain("useExitPresenceList");
    expect(history).toContain("resetKey: query");
    const home = read("components/kiro/navigation/KiroNavigatorHome.tsx");
    expect(home).toContain("DisclosureRegion open={showAllThreads}");
    const countdown = read("components/kiro/run/ApprovalCountdown.tsx");
    expect(countdown).toContain("tabular-nums");
  });

  it("深度排查 Batch1：计时错位收敛（presence 常量与 CSS 同源）", () => {
    const conversation = read("components/kiro/KiroConversation.tsx");
    expect(conversation).toContain("usePresence(showScrollBtn, MOTION_EXIT_MS.fast)");
    expect(conversation).not.toContain("MOTION_MS.fast");
    expect(conversation).toContain("scrollBtnPresence.visible");
    const css = read("app/globals.css");
    expect(css).toContain("opacity var(--motion-exit-fast) var(--ease-exit)");
    expect(css).toContain("animation: kiro-empty-out var(--motion-exit-panel) var(--ease-exit) both;");
    const center = read("components/reminders/ReminderCenter.tsx");
    expect(center).toContain("usePresence(editor !== null, MOTION_EXIT_MS.base)");
    expect(center).not.toContain("MOTION_MS.base");
    const viewport = read("components/reminders/ReminderViewport.tsx");
    expect(viewport).toContain("MOTION_EXIT_MS.fast");
    expect(viewport).toContain("!duration-[var(--motion-exit-fast)]");
    const navigator = read("components/kiro/navigation/KiroNavigator.tsx");
    expect(navigator).toContain("usePresence(!expanded, MOTION_EXIT_MS.fast)");
    expect(navigator).toContain("duration-[var(--motion-exit-fast)]");
  });

  it("卡顿点：动画元素无 backdrop-blur；tray 退出期间锁 overflow-x（防滚动条闪烁）", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    // 拖拽遮罩透明度动画 + backdrop-blur = 逐帧重模糊（已知卡顿源，已下线；只查工具类，不含注释）
    expect(composer).not.toMatch(/backdrop-blur-\[/);
    expect(composer).toContain("overflow-x-clip");
    expect(composer).toContain("overflow-x-auto");
  });
});
