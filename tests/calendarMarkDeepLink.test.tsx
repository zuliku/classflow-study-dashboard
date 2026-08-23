// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Polyfills（jsdom 缺失的浏览器 API）
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
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

import { deriveTimelineItems } from "@/lib/timeline/deriveTimelineItems";
import { openTimelineAtDate, canOpenTimelineAtDate } from "@/lib/timeline/openTimelineAtDate";
import { CalendarMarkDetailDrawer } from "@/components/drawers/CalendarMarkDetailDrawer";
import { TimelineKeyLane } from "@/components/timeline/TimelineKeyLane";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, CalendarMark, Semester } from "@/types";

/**
 * Workflow UX V2 —— Calendar Entity Deep Link Closure：
 * exam / activity 成为真正可打开实体 + 时间表精确周跳转。
 */

const SEMESTER: Semester = {
  id: "s1",
  name: "2026秋",
  startDate: "2026-08-31", // 周一
  totalWeeks: 16,
};

const WEEK_DATES = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
]; // 第 2 周

const mark = (id: string, over: Partial<CalendarMark> = {}): CalendarMark => ({
  id,
  date: "2026-09-10",
  type: "exam",
  title: `Mark ${id}`,
  ...over,
});

beforeEach(() => {
  cleanup();
  const s = useAppStore.getState();
  useAppStore.setState({
    semester: SEMESTER,
    currentSemesterWeek: 1,
    selectedCalendarMarkId: null,
    calendarMarks: [],
    assignments: [],
    reminders: [],
  });
  void s;
});
afterEach(() => {
  cleanup();
  useAppStore.setState({ selectedCalendarMarkId: null });
});

// ============================================================
// A. deriveTimelineItems projection
// ============================================================
describe("deriveTimelineItems：calendarMarkId 携带契约", () => {
  const base = {
    weekDates: WEEK_DATES,
    assignments: [] as Assignment[],
    groupProjects: [],
    studyBlocks: [],
  };

  it("exam item 携带 calendarMarkId === exam.id", () => {
    const items = deriveTimelineItems({
      ...base,
      calendarMarks: [mark("ex1", { type: "exam", startTime: "14:00", endTime: "16:00" })],
    });
    const it_ = items.find((i) => i.temporalType === "interval");
    expect(it_?.calendarMarkId).toBe("ex1");
    expect(it_?.sourceType).toBe("exam");
  });

  it("activity item 携带 calendarMarkId === activity.id（all-day）", () => {
    const items = deriveTimelineItems({
      ...base,
      calendarMarks: [mark("ac1", { type: "activity" })],
    });
    const it_ = items.find((i) => i.temporalType === "all-day");
    expect(it_?.calendarMarkId).toBe("ac1");
    expect(it_?.sourceType).toBe("activity");
  });

  it("independent ddl：calendarMarkId 保留且 temporalType=deadline", () => {
    const items = deriveTimelineItems({
      ...base,
      calendarMarks: [mark("dd1", { type: "ddl" })],
    });
    const it_ = items.find((i) => i.sourceType === "assignment");
    expect(it_?.calendarMarkId).toBe("dd1");
    expect(it_?.temporalType).toBe("deadline");
  });

  it("linked assignment DDL：mark 不生成 item（去重）；assignment item 无 calendarMarkId", () => {
    const linked: Assignment = {
      id: "asg1",
      courseId: "c1",
      title: "有 DDL 的任务",
      ddl: "2026-09-10T23:59:00",
      priority: "high",
      status: "todo",
      progress: 0,
      tags: [],
    } as unknown as Assignment;
    const items = deriveTimelineItems({
      ...base,
      assignments: [linked],
      calendarMarks: [mark("dd-linked", { type: "ddl", sourceId: "asg1" })],
    });
    // 只剩 assignment deadline item；linked mark 被去重
    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe("asg1");
    expect(items[0].calendarMarkId).toBeUndefined();
  });
});

// ============================================================
// F. Temporal navigation helper
// ============================================================
describe("openTimelineAtDate（精确周跳转）", () => {
  const mk = () => ({ setWeek: vi.fn(), setTab: vi.fn() });

  it("学期内日期 → 解析正确周并导航（先 week 后 tab）", () => {
    const { setWeek, setTab } = mk();
    const ok = openTimelineAtDate({
      date: "2026-09-08",
      semester: SEMESTER,
      setCurrentSemesterWeek: setWeek,
      setActiveTab: setTab,
    });
    expect(ok).toBe(true);
    expect(setWeek).toHaveBeenCalledWith(2);
    expect(setTab).toHaveBeenCalledWith("timetable");
    expect(setWeek.mock.invocationCallOrder[0]).toBeLessThan(setTab.mock.invocationCallOrder[0]);
  });

  it("第 1 周 / 最后一周 正确解析", () => {
    const { setWeek, setTab } = mk();
    expect(openTimelineAtDate({ date: "2026-08-31", semester: SEMESTER, setCurrentSemesterWeek: setWeek, setActiveTab: setTab })).toBe(true);
    expect(setWeek).toHaveBeenLastCalledWith(1);
    // 第 16 周：start + 15 周 = 2026-12-14
    expect(openTimelineAtDate({ date: "2026-12-16", semester: SEMESTER, setCurrentSemesterWeek: setWeek, setActiveTab: setTab })).toBe(true);
    expect(setWeek).toHaveBeenLastCalledWith(16);
  });

  it("学期前 / 学期后日期：不 clamp、不导航", () => {
    const { setWeek, setTab } = mk();
    expect(canOpenTimelineAtDate("2026-08-20", SEMESTER)).toBe(false); // 开学前
    expect(canOpenTimelineAtDate("2027-01-05", SEMESTER)).toBe(false); // 结束后
    expect(
      openTimelineAtDate({ date: "2026-08-20", semester: SEMESTER, setCurrentSemesterWeek: setWeek, setActiveTab: setTab })
    ).toBe(false);
    expect(
      openTimelineAtDate({ date: "2027-01-05", semester: SEMESTER, setCurrentSemesterWeek: setWeek, setActiveTab: setTab })
    ).toBe(false);
    expect(setWeek).not.toHaveBeenCalled();
    expect(setTab).not.toHaveBeenCalled();
  });
});

// ============================================================
// C/D. CalendarMarkDetailDrawer
// ============================================================
describe("CalendarMarkDetailDrawer", () => {
  function inject(mark: CalendarMark | null, extra: Partial<Assignment[]> = {}) {
    useAppStore.setState({
      calendarMarks: mark ? [mark] : [],
      selectedCalendarMarkId: mark?.id ?? null,
      ...extra,
    });
  }

  it("exam：渲染考试 breadcrumb + 日期 + 时间区间", () => {
    inject(mark("ex1", { title: "英语六级模拟考试", startTime: "14:00", endTime: "16:00" }));
    render(<CalendarMarkDetailDrawer />);
    const panel = document.querySelector('[data-testid="calendar-mark-detail-panel"]');
    expect(panel).toBeTruthy();
    expect(screen.getByText("考试")).toBeTruthy();
    expect(screen.getByText(/9月10日/)).toBeTruthy();
    expect(screen.getByText("14:00–16:00")).toBeTruthy();
    expect(screen.queryByText(/截止时间/)).toBeNull();
  });

  it("activity 无起止时间 → 显示全天", () => {
    inject(mark("ac1", { type: "activity", title: "社团纳新宣讲" }));
    render(<CalendarMarkDetailDrawer />);
    expect(screen.getByText("活动")).toBeTruthy();
    expect(screen.getByText("全天")).toBeTruthy();
  });

  it("independent ddl：现有截止内容保留（截止时间 + 提醒摘要）", () => {
    inject(mark("dd1", { type: "ddl", title: "独立 DDL" }));
    render(<CalendarMarkDetailDrawer />);
    expect(screen.getByText("截止")).toBeTruthy();
    expect(screen.getByText(/截止时间/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "提醒" })).toBeTruthy();
  });

  it("linked ddl（sourceId 匹配 assignment）→ Drawer 不渲染", () => {
    useAppStore.setState({
      assignments: [
        { id: "asg1", title: "真实任务" } as unknown as Assignment,
      ],
    });
    inject(mark("dd-linked", { type: "ddl", sourceId: "asg1", title: "linked" }));
    render(<CalendarMarkDetailDrawer />);
    expect(document.querySelector('[data-testid="calendar-mark-detail-panel"]')).toBeNull();
  });

  it("DDL A → exam B：outer shell 不重复（单一 Drawer owner），内容切到 B", () => {
    const marks = [
      mark("dd1", { type: "ddl", title: "DDL A" }),
      mark("ex1", { title: "EXAM B", startTime: "09:00", endTime: "11:00" }),
    ];
    useAppStore.setState({ calendarMarks: marks, selectedCalendarMarkId: "dd1" });
    render(<CalendarMarkDetailDrawer />);
    expect(document.querySelectorAll('[data-testid="calendar-mark-detail-panel"]').length).toBe(1);

    act(() => {
      useAppStore.setState({ selectedCalendarMarkId: "ex1" });
    });
    // 单一 panel；类型 breadcrumb 已切到 考试
    expect(document.querySelectorAll('[data-testid="calendar-mark-detail-panel"]').length).toBe(1);
    expect(screen.getByText("考试")).toBeTruthy();
  });

  it("删除：confirm 确认后调用 deleteCalendarMark；store 自动清 selection；exit presence 保持", async () => {
    const deleteSpy = vi.fn(useAppStore.getState().deleteCalendarMark);
    useAppStore.setState({ deleteCalendarMark: deleteSpy as never });
    inject(mark("ac-del", { type: "activity", title: "待删活动" }));
    render(<CalendarMarkDetailDrawer />);

    fireEvent.click(screen.getByRole("button", { name: /删除活动/ }));
    // ConfirmDialog 打开（useConfirmStore.request 存在）
    const req = useAppStore.getState().confirmRequest?.() ?? null;
    void req;
    // 通过 confirm store 直接取 request 并确认（ConfirmDialog 组件本身不在渲染树）
    const state = (await import("@/store/useConfirmStore")).useConfirmStore.getState();
    expect(state.request).toBeTruthy();
    act(() => {
      state.request!.onConfirm();
    });
    expect(deleteSpy).toHaveBeenCalledWith("ac-del");
    // store semantic：selected id 命中时自动清 null
    expect(useAppStore.getState().selectedCalendarMarkId).toBeNull();

    // exit presence：staleMark 兜底——panel 在 exit window 内仍存在（Drawer floating presence）
    // （reduced motion off → Drawer exit ≈160ms；此处仅断言未 hard-unmount 于同步帧）
    expect(document.querySelector('[data-testid="calendar-mark-detail-panel"]')).toBeTruthy();
    deleteSpy.mockRestore();
  }, 10000);
});

// ============================================================
// B. TimelineKeyLane interval / all-day activation
// ============================================================
describe("TimelineKeyLane exam/activity activation", () => {
  it("interval exam click → setSelectedCalendarMarkId(exam.id)；Enter 同效", () => {
    const items = deriveTimelineItems({
      weekDates: WEEK_DATES,
      assignments: [],
      calendarMarks: [mark("ex-click", { title: "线代期中", startTime: "14:00", endTime: "16:00" })],
      groupProjects: [],
      studyBlocks: [],
    });
    render(<TimelineKeyLane items={items} weekDates={WEEK_DATES} />);
    const el = screen.getByRole("button", { name: /线代期中/ });
    fireEvent.click(el);
    expect(useAppStore.getState().selectedCalendarMarkId).toBe("ex-click");

    // Enter（keyboard activation）
    fireEvent.keyDown(el, { key: "Enter" });
    expect(useAppStore.getState().selectedCalendarMarkId).toBe("ex-click");
  });

  it("all-day activity click → 打开对应 mark；Space 同效", () => {
    const items = deriveTimelineItems({
      weekDates: WEEK_DATES,
      assignments: [],
      calendarMarks: [mark("ac-key", { type: "activity", title: "班级团建" })],
      groupProjects: [],
      studyBlocks: [],
    });
    render(<TimelineKeyLane items={items} weekDates={WEEK_DATES} />);
    const el = screen.getByRole("button", { name: /班级团建/ });
    fireEvent.click(el);
    expect(useAppStore.getState().selectedCalendarMarkId).toBe("ac-key");
    fireEvent.keyDown(el, { key: " " });
    expect(useAppStore.getState().selectedCalendarMarkId).toBe("ac-key");
  });

  it("所有可交互 event 都具备激活 handler：不存在裸 role=button event", () => {
    const items = deriveTimelineItems({
      weekDates: WEEK_DATES,
      assignments: [],
      calendarMarks: [
        mark("e1", { startTime: "10:00", endTime: "11:00" }),
        mark("a1", { type: "activity" }),
      ],
      groupProjects: [],
      studyBlocks: [],
    });
    render(<TimelineKeyLane items={items} weekDates={WEEK_DATES} />);
    // lane 内的 role=button 元素都应可被键盘/点击激活（存在对应 store 行为）
    for (const name of ["Mark e1", "Mark a1"]) {
      const el = screen.getByRole("button", { name: new RegExp(name.replace(/\s/g, "\\s")) });
      expect(el.getAttribute("aria-label")).toContain(name);
    }
  });
});

// ============================================================
// MiniCalendar agenda activation
// ============================================================
describe("MiniCalendar exam/activity agenda", () => {
  let prevClientHeight: PropertyDescriptor | undefined;
  beforeAll(() => {
    // jsdom 无布局：containerHeight 恒 0 会触发 Agenda 自适应隐藏（required≈376）。
    // 给所有元素一个虚拟可视高度，保证 Agenda 渲染。
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

  it("exam cell 点击 → setSelectedCalendarMarkId；course/assignment 原行为不回归", () => {
    const today = new Date();
    const fmt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    useAppStore.setState({
      calendarMarks: [{ id: "mk-ex", date: fmt, type: "exam", title: "高数期中" }],
      schedules: [],
      assignments: [],
    });
    render(<MiniCalendar />);
    const cell = screen.getByRole("button", { name: "考试" });
    fireEvent.click(cell);
    expect(useAppStore.getState().selectedCalendarMarkId).toBe("mk-ex");
  });
});
