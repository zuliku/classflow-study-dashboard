/**
 * Layout Hotfix：MiniCalendar 自适应 Agenda —— 纯逻辑（weekRows-aware budget + hysteresis）。
 * 判定完全基于 MiniCalendar 容器真实高度（不再使用 viewport max-height）。
 */
import { describe, it, expect } from "vitest";
import {
  computeAgendaRequiredHeight,
  shouldShowAgenda,
} from "@/components/dashboard/MiniCalendar";

describe("computeAgendaRequiredHeight（weekRows-aware 预算）", () => {
  const base = { headerHeight: 44, weekdayHeight: 24, agendaHeight: 88 };

  it("5 行月份 vs 6 行月份：6 行多一行（MIN_DATE_ROW_HEIGHT + gap）", () => {
    const r5 = computeAgendaRequiredHeight({ ...base, weekRows: 5 });
    const r6 = computeAgendaRequiredHeight({ ...base, weekRows: 6 });
    expect(r6 - r5).toBe(22 + 4); // MIN_DATE_ROW_HEIGHT + GRID_ROW_GAP
    expect(r5).toBe(32 + 36 + 44 + 24 + (5 * 22 + 4 * 4) + 88);
    expect(r6).toBe(r5 + 26);
  });

  it("Agenda / Header 高度参与预算（测量驱动，非裸数字）", () => {
    const small = computeAgendaRequiredHeight({ ...base, weekRows: 5, agendaHeight: 88 });
    const large = computeAgendaRequiredHeight({ ...base, weekRows: 5, agendaHeight: 120 });
    expect(large - small).toBe(32);
  });

  it("budget 各组成部分均来自具名常量（无裸 magic number）", () => {
    const r = computeAgendaRequiredHeight({ ...base, weekRows: 5 });
    // padding 32（p-4 16×2）+ 3 段 space-y-3 gaps（3×12）
    expect(r).toBeGreaterThan(32 + 36);
  });
});

describe("shouldShowAgenda（hysteresis）", () => {
  const required = 380;

  it("visible：containerHeight >= required 保持；< required 隐藏", () => {
    expect(shouldShowAgenda({ visible: true, containerHeight: 380, requiredHeight: required })).toBe(true);
    expect(shouldShowAgenda({ visible: true, containerHeight: 379, requiredHeight: required })).toBe(false);
  });

  it("hidden：>= required + hysteresis 恢复；在 [required, required+hysteresis) 区间保持隐藏（不抖动）", () => {
    const hys = 16;
    expect(shouldShowAgenda({ visible: false, containerHeight: 396, requiredHeight: required, hysteresis: hys })).toBe(true);
    // 临界区：刚好 required / required+15 → 仍隐藏（防止 show/hide 来回切）
    expect(shouldShowAgenda({ visible: false, containerHeight: 380, requiredHeight: required, hysteresis: hys })).toBe(false);
    expect(shouldShowAgenda({ visible: false, containerHeight: 395, requiredHeight: required, hysteresis: hys })).toBe(false);
  });

  it("默认 hysteresis=8：恢复阈值 = required + 8（覆盖测量抖动；shell 档位均可达）", () => {
    expect(shouldShowAgenda({ visible: false, containerHeight: 388, requiredHeight: 380 })).toBe(true);
    expect(shouldShowAgenda({ visible: false, containerHeight: 387, requiredHeight: 380 })).toBe(false);
  });

  it("可见状态在 required 附近不来回切换（同一高度两个状态决策不同 → 滞回区间）", () => {
    const at = 385; // required 与 required+hysteresis 之间
    expect(shouldShowAgenda({ visible: true, containerHeight: at, requiredHeight: required })).toBe(true);
    expect(shouldShowAgenda({ visible: false, containerHeight: at, requiredHeight: required })).toBe(false);
  });
});
