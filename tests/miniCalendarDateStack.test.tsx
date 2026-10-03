// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import React, { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { format, addDays } from "date-fns";

// ---- jsdom Polyfills（与 timelineStudyBlockExecution 同一套约定）----
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver =
  RO as unknown as typeof ResizeObserver;
// MiniCalendar DDL drag 需要 wide + fine 双命中；其余 query 保持 false
(window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
  matches: query.includes("min-width: 768px") || query.includes("pointer: fine"),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}
// MiniCalendar selection indicator 使用 CSS.escape（jsdom 未实现）
if (typeof window !== "undefined") {
  const w = window as unknown as { CSS?: { escape?: (s: string) => string } };
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) {
    w.CSS.escape = (s: string) =>
      String(s).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, (c) => `\\${c}`);
  }
}
// elementFromPoint：默认 null（pointer 不在日历上）；DDL target 测试按用例覆写
const originalElementFromPoint = () => null;
(document as unknown as Record<string, unknown>).elementFromPoint = originalElementFromPoint;
// jsdom 无 PointerEvent：fireEvent.pointerDown 会退化为普通 Event（clientX 全丢），
// DDL drag 阈值判断依赖 clientX/Y。补最小 PointerEvent（MouseEvent 携带 pointerId）。
if (typeof window !== "undefined" && !(window as unknown as { PointerEvent?: unknown }).PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// Agenda 可见性依赖 clientHeight（jsdom 恒 0）→ 虚拟可视高度
let prevClientHeight: PropertyDescriptor | undefined;
beforeAll(() => {
  prevClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 500;
    },
  });
});
afterAll(() => {
  if (prevClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", prevClientHeight);
  }
});

import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment } from "@/types";

const TODAY_KEY = format(new Date(), "yyyy-MM-dd");
const TOMORROW_KEY = format(addDays(new Date(), 1), "yyyy-MM-dd");

const mkDdlAssignment = (id: string, ddlDateKey: string): Assignment =>
  ({
    id,
    courseId: null,
    title: `高数作业-${id}`,
    description: "",
    ddl: `${ddlDateKey}T23:59:00`,
    priority: "high",
    status: "doing",
    progress: 0,
    tags: [],
  }) as unknown as Assignment;

beforeEach(() => {
  cleanup();
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    schedules: [],
    assignments: [],
    calendarMarks: [],
    courses: [],
    preferences: { ...prefs, enableDDLDirectManipulation: true },
  });
});

afterEach(() => {
  cleanup();
  (document as unknown as Record<string, unknown>).elementFromPoint = originalElementFromPoint;
});

function getCell(dateKey: string): HTMLElement {
  return document.querySelector(`[data-calendar-day="${dateKey}"]`) as HTMLElement;
}

// ============================================================
// PART A —— Fixed Content Stack（数字 ↔ indicator rail 固定相对距离）
// ============================================================
describe("MiniCalendar date content stack", () => {
  it("日期数字 leading-none；content stack gap-1；rail 存在且 h-1、非 absolute", () => {
    render(<MiniCalendar />);
    const cell = getCell(TODAY_KEY);
    expect(cell).toBeTruthy();

    const content = cell.querySelector('[data-testid="calendar-date-content"]') as HTMLElement;
    expect(content).toBeTruthy();
    // 数字 → gap-1(4px) → rail
    expect(content.className).toContain("gap-1");

    const number = content.firstElementChild as HTMLElement;
    expect(number.textContent).toBe(format(new Date(), "d"));
    expect(number.className).toContain("leading-none");

    const rail = cell.querySelector('[data-testid="calendar-indicator-rail"]') as HTMLElement;
    expect(rail).toBeTruthy();
    expect(rail.getAttribute("aria-hidden")).toBe("true");
    expect(rail.className).toContain("h-1");
    // 禁止回归：dots 容器不得回到 absolute / bottom-* 定位
    expect(rail.className).not.toContain("absolute");
    const inCellAbsolute = Array.from(cell.querySelectorAll("*")).filter((el) =>
      el.classList.contains("absolute")
    );
    expect(inCellAbsolute).toHaveLength(0);
  });

  it("有事件日期：dots 在 rail 内，w-1 h-1 rounded-full，无 absolute bottom", () => {
    useAppStore.setState({ assignments: [mkDdlAssignment("a-today", TODAY_KEY)] });
    render(<MiniCalendar />);
    const cell = getCell(TODAY_KEY);
    const rail = cell.querySelector('[data-testid="calendar-indicator-rail"]') as HTMLElement;
    const dots = rail.querySelectorAll(":scope > span");
    expect(dots.length).toBeGreaterThanOrEqual(1);
    for (const dot of dots) {
      expect(dot.className).toContain("w-1");
      expect(dot.className).toContain("h-1");
      expect(dot.className).toContain("rounded-full");
      expect(dot.className).not.toContain("absolute");
    }
  });

  it("无事件日期仍 render rail（数字垂直位置与有点日期完全一致）", () => {
    useAppStore.setState({ assignments: [mkDdlAssignment("a-today", TODAY_KEY)] });
    render(<MiniCalendar />);
    const otherCells = Array.from(
      document.querySelectorAll("[data-calendar-day]")
    ).filter((el) => el.getAttribute("data-calendar-day") !== TODAY_KEY) as HTMLElement[];
    expect(otherCells.length).toBeGreaterThan(0);
    for (const cell of otherCells) {
      const rail = cell.querySelector('[data-testid="calendar-indicator-rail"]');
      expect(rail).toBeTruthy();
      // 空 rail：内部无 dots
      expect((rail as HTMLElement).querySelectorAll(":scope > span").length).toBe(0);
    }
  });

  it("MIN_DATE_ROW_HEIGHT 保持 22：grid rows minmax(22px, 1fr)", () => {
    render(<MiniCalendar />);
    const grid = document.querySelector("[data-selected-date]") as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.style.gridTemplateRows).toContain("minmax(22px, 1fr)");
  });
});

// ============================================================
// Motion M5 —— MiniCalendar DDL drag feedback（source subdued / target outline /
// preview 无 left/top transition）
// ============================================================
describe("MiniCalendar DDL drag feedback", () => {
  function engageDdlDrag() {
    const src = document.querySelector('[data-testid="agenda-ddl-item"]') as HTMLElement;
    fireEvent.pointerDown(src, { button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    // 跨过 5px 阈值 → dragging
    fireEvent.pointerMove(src, { clientX: 312, clientY: 300, pointerId: 1 });
    return src;
  }

  it("dragging 时 source card subdued（opacity-40）且 pointer preview 即时跟随（无 transition）", async () => {
    useAppStore.setState({ assignments: [mkDdlAssignment("a-drag", TODAY_KEY)] });
    render(<MiniCalendar />);
    const src = engageDdlDrag();
    // pointermove 经 rAF 合并（与课表拖拽同模式）：等一帧再断言
    await act(async () => {
      await new Promise((r) => setTimeout(r, 32));
    });

    expect(src.className).toContain("opacity-40");

    const preview = document.querySelector('[data-testid="ddl-drag-preview"]') as HTMLElement;
    expect(preview).toBeTruthy();
    // preview left/top 直接内联跟随指针：禁止任何 position transition（拖尾回归锁）
    expect(preview.style.transition).toBe("");
    expect(/transition/.test(preview.className)).toBe(false);

    fireEvent.pointerUp(src, { clientX: 312, clientY: 300, pointerId: 1 });
  });

  it("hover 目标日期保持 1px 低对比 outline target surface；非目标格低饱和 outline", async () => {
    useAppStore.setState({ assignments: [mkDdlAssignment("a-drag2", TODAY_KEY)] });
    render(<MiniCalendar />);
    const src = engageDdlDrag();

    const targetCell = getCell(TOMORROW_KEY);
    (document as unknown as Record<string, unknown>).elementFromPoint = () => ({
      closest: (selector: string) =>
        selector === "[data-calendar-day]" ? targetCell : null,
    });
    fireEvent.pointerMove(src, { clientX: 320, clientY: 302, pointerId: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 32));
    });
    // rAF 合并后：第一帧只完成阈值跨越（hover=null），再补一帧才计算 hover 目标
    fireEvent.pointerMove(src, { clientX: 320, clientY: 302, pointerId: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 32));
    });

    // 统一 Timeline 强度：1px 低对比 ring + 极弱 tint（不大面积填色）
    expect(targetCell.className).toContain("outline-charcoal/30");
    expect(targetCell.className).toContain("bg-alabaster/55");

    const idleCell = getCell(TODAY_KEY);
    expect(idleCell.className).toContain("outline-line-soft");
    expect(idleCell.className).not.toContain("outline-charcoal/30");

    fireEvent.pointerUp(src, { clientX: 320, clientY: 302, pointerId: 1 });
  });
});
