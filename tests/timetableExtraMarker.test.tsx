// @vitest-environment jsdom
/**
 * UI Hotfix：Timetable 补课 "＋" marker（source === "extra" 才显示）。
 * 判定来源：EffectiveCourseOccurrence.source（唯一 Source of Truth）——
 * 不扫描 overrides / 不猜 id prefix / 不加 Store 字段。
 * - base → 无 marker
 * - moved → 无 marker（临时调课不是补课）
 * - extra → 显示 "＋"（title/accessible = 补课）
 * - extra + conflict → marker 仍存在（不覆盖冲突 Badge）
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { useAppStore } from "@/store/useAppStore";

function seedStore() {
  const state = useAppStore.getState();
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const pad2 = (n: number) => String(n).padStart(2, "0");
  useAppStore.setState({
    semester: {
      id: "sem_test",
      name: "测试学期",
      startDate: `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`,
      totalWeeks: 16,
    },
    currentSemesterWeek: 1,
    courses: [
      {
        id: "c1",
        name: "高等数学",
        code: "MATH101",
        teacher: "张老师",
        classroom: "教学楼101",
        credit: 4,
        bgHex: "#F7F3EA",
        borderHex: "#E5DCC8",
        textHex: "#6B5D43",
        description: "",
        materials: [],
      },
      {
        id: "c2",
        name: "大学英语",
        code: "ENG101",
        teacher: "李老师",
        classroom: "教学楼202",
        credit: 3,
        bgHex: "#EEF1F7",
        borderHex: "#D5DCE8",
        textHex: "#4A5570",
        description: "",
        materials: [],
      },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "教学楼101", weeks: "1-16周" },
      { id: "s2", courseId: "c2", dayOfWeek: 2, startTime: "14:00", endTime: "15:40", location: "教学楼202", weeks: "1-16周" },
    ],
    // extra（补课，第 1 周周二 18:00——与 s2 不同时段，无冲突）+ move（临时调课）
    scheduleOccurrenceOverrides: [
      { id: "o_extra", kind: "extra", courseId: "c1", week: 1, dayOfWeek: 2, startTime: "18:00", endTime: "19:40", location: "教学楼301", source: "manual" },
      { id: "o_move", kind: "move", courseId: "c1", baseScheduleId: "s1", week: 1, dayOfWeek: 3, startTime: "16:00", endTime: "17:40", location: "教学楼101", source: "manual" },
    ] as never,
    preferences: { ...state.preferences, showWeekends: true, enableScheduleDirectManipulation: false },
  });
}

function renderGrid() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TimetableGrid editable={false} />);
  });
  const cards = () => Array.from(container.querySelectorAll('[data-testid="schedule-card"]'));
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, cards, cleanup };
}

beforeEach(() => {
  // jsdom 无 matchMedia（TimetableGrid 用 media queries 判断直接编辑能力）
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  seedStore();
});

describe("Timetable 补课 ＋ marker（source === 'extra'）", () => {
  it("base occurrence → 无 marker", () => {
    const { cards, cleanup } = renderGrid();
    // 周一 10:00 高等数学 = base
    const base = cards().find((c) => (c.textContent ?? "").includes("高等数学") && (c.textContent ?? "").includes("周一")) ?? cards()[0];
    expect(base.textContent).not.toContain("补课");
    expect(base.querySelector('span[title="补课"]')).toBeNull();
    cleanup();
  });

  it("moved occurrence → 无 marker（临时调课不是补课）", () => {
    const { container, cards, cleanup } = renderGrid();
    // 周三列 = moved（s1 临时调课目标位）
    const moved = cards().find((c) =>
      container.querySelector('[data-timetable-day="3"]')!.contains(c)
    );
    expect(moved).toBeTruthy();
    expect(moved!.textContent).toContain("高等数学");
    expect(moved!.querySelector('span[title="补课"]')).toBeNull();
    expect(moved!.textContent).not.toContain("补课");
    cleanup();
  });

  it("extra occurrence → 显示 ＋（title/accessible = 补课）", () => {
    const { cards, cleanup } = renderGrid();
    const extra = cards().find((c) => (c.textContent ?? "").includes("教学楼301"));
    expect(extra).toBeTruthy();
    const marker = extra!.querySelector('span[title="补课"]');
    expect(marker).toBeTruthy();
    // "+" 与 sr-only 补课（可访问文本；非按钮）
    expect(marker!.querySelector('span[aria-hidden="true"]')?.textContent).toBe("+");
    expect(marker!.querySelector(".sr-only")?.textContent).toBe("补课");
    expect(marker!.tagName).toBe("SPAN");
    cleanup();
  });

  it("extra 位于 Bottom Row 最左侧（MapPin 之前）", () => {
    const { cards, cleanup } = renderGrid();
    const extra = cards().find((c) => (c.textContent ?? "").includes("教学楼301"));
    const bottomRow = Array.from(extra!.querySelectorAll("div")).find(
      (d) => d.querySelector('span[title="补课"]') && d.querySelector("svg")
    );
    expect(bottomRow).toBeTruthy();
    const children = Array.from(bottomRow!.children).map((el) => el.tagName);
    // 顺序：span(marker) → svg(MapPin) → span(location)（SVG 元素 tagName 为小写）
    expect(children[0]).toBe("SPAN");
    expect(children[1].toLowerCase()).toBe("svg");
    expect(children[2]).toBe("SPAN");
    cleanup();
  });

  it("extra + conflict → marker 仍存在；冲突 Badge 不受影响", () => {
    // 制造冲突：给周二 18:00 的 extra 叠加同一时段另一课程
    const state = useAppStore.getState();
    useAppStore.setState({
      schedules: [
        ...state.schedules,
        { id: "s3", courseId: "c2", dayOfWeek: 2, startTime: "18:00", endTime: "19:40", location: "教学楼101", weeks: "1-16周" },
      ],
    });
    const { cards, cleanup } = renderGrid();
    // 冲突双方（base s3 与 extra）都带冲突 Badge；extra 卡同时保留 ＋ marker
    const conflictCards = cards().filter((c) => (c.textContent ?? "").includes("冲突"));
    expect(conflictCards.length).toBeGreaterThanOrEqual(2);
    const extraWithConflict = conflictCards.find((c) => c.querySelector('span[title="补课"]'));
    expect(extraWithConflict).toBeTruthy();
    const badge = Array.from(extraWithConflict!.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("冲突")
    );
    expect(badge).toBeTruthy();
    cleanup();
  });
});
