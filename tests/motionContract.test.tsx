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

import { MOTION_MS, MOTION_EXIT_MS } from "@/lib/motion";
import { usePresence } from "@/lib/usePresence";
import { useAppStore } from "@/store/useAppStore";

/**
 * Motion Foundation V2 Contract 测试：
 * 一种交互语义只存在一个 Motion 时间真值 ——
 * 1. CSS token（globals.css）↔ JS 常量（lib/motion.ts）数值一致
 * 2. Primitive 不再出现裸魔法 duration / exit timer 分裂
 * 3. presence lifecycle：open → mounted hidden → visible → close → hidden → duration 后 unmount
 * 4. Reduced Motion：不等待 exit timer，立即落最终态
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
    // ToastViewport：EXIT_MS 与 ux-inline（--motion-fast）同源
    const toast = read("components/ui/ToastViewport.tsx");
    expect(toast).toContain("EXIT_MS = MOTION_MS.fast");
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
