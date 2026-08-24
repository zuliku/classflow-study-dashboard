// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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

vi.mock("@/lib/reminders/browserNotifications", () => ({
  showBrowserReminderNotification: vi.fn(),
}));
vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({ openForGroupProject: vi.fn(), openForWeek: vi.fn() }),
}));
vi.mock("@/components/kiro/KiroSessionProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/kiro/KiroSessionProvider")>();
  return {
    ...mod,
    KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useKiroSession: () => ({
      planningPreview: null, setPlanningPreview: vi.fn(),
      studyRebalancePreview: null, setStudyRebalancePreview: vi.fn(),
      handoffPrompt: null,
    }),
    useKiroSessionMeta: () => ({ kiroBusy: false }),
    useKiroSessionActions: () => ({ claimEmptyIntro: vi.fn(), openSidecar: vi.fn(), closeSidecar: vi.fn(), expandSidecar: vi.fn(), minimizeSidecar: vi.fn(), restoreSidecar: vi.fn() }),
  };
});

import {
  navigateReminderTarget,
} from "@/lib/reminders/reminderNavigation";
import { ReminderRuntime } from "@/components/reminders/ReminderRuntime";
import { useAppStore } from "@/store/useAppStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { showBrowserReminderNotification } from "@/lib/reminders/browserNotifications";
import type { Assignment, CalendarMark, Course, Reminder, Semester } from "@/types";

/**
 * Workflow UX V16 —— Reminder → Exact Target Navigation：
 * 单一 canonical routing（navigateReminderTarget）+ 三 surface（Runtime / Viewport / Center）
 * delegate + read semantics。Fresh Store：点击时刻重新解析 target。
 */

const NOW_BASE = new Date("2026-03-10T12:00:00").getTime();
// 第 10 周周一（学期 2026-03-09 起第 1 周为 03-09…）
const WEEK4_MON = "2026-03-30";
const WEEK10_MON = "2026-05-11";

const SEMESTER: Semester = { id: "s1", name: "x", startDate: "2026-03-09", totalWeeks: 16 };
const COURSE: Course = { id: "c1", name: "计量经济学" } as unknown as Course;

const mkReminder = (over: Partial<Reminder> & { id: string }): Reminder =>
  ({
    title: `提醒 ${over.id}`,
    targetType: "assignment",
    targetId: undefined,
    timingMode: "relative",
    offsetMinutes: 30,
    triggerAt: `${WEEK10_MON}T08:00:00`,
    status: "fired",
    source: "manual",
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Reminder;

let seedSeq = 0;
function seedBase(opts?: { week?: number }) {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [COURSE],
    assignments: [{ id: "a-1", courseId: "c1", title: "实证报告", status: "doing", ddl: `${WEEK10_MON}T23:59:00` } as unknown as Assignment],
    schedules: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [
      // 第 10 周 StudyBlock（含 released 历史 block 变体在各用例覆盖）
      { id: "sb-w10", title: "学习计划", date: WEEK10_MON, startTime: "14:00", endTime: "15:00", assignmentId: "a-1" },
    ],
    reminders: [],
    semester: SEMESTER,
    currentSemesterWeek: opts?.week ?? 4,
    activeTab: "overview" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    focusSessions: [],
    preferences: { ...prefs },
  });
}

beforeEach(() => {
  cleanup();
  seedSeq += 1;
});
afterEach(() => {
  cleanup();
});

describe("navigateReminderTarget — assignment contract", () => {
  it("valid assignment → selectedAssignmentId = exact id；activeTab 不变（Global Drawer）", () => {
    seedBase();
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "assignment", targetId: "a-1" }));
    expect(result).toBe("assignment");
    const s = useAppStore.getState();
    expect(s.selectedAssignmentId).toBe("a-1");
    expect(s.activeTab).toBe("overview"); // 不切 Workspace
  });

  it("stale assignment → no-op 不写 stale selection；结果 stale", () => {
    seedBase();
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "assignment", targetId: "a-gone" }));
    expect(result).toBe("stale");
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

describe("navigateReminderTarget — studyBlock exact week", () => {
  it("第 4 周 → 点击第 10 周 StudyBlock reminder：跳第 10 周 + timetable", () => {
    seedBase({ week: 4 });
    const r = mkReminder({ id: `r${seedSeq}`, targetType: "studyBlock", targetId: "sb-w10" });
    expect(navigateReminderTarget(r)).toBe("study-block");
    const s = useAppStore.getState();
    expect(s.currentSemesterWeek).toBe(10);
    expect(s.activeTab).toBe("timetable");
  });

  it("released StudyBlock 历史 reminder 仍可导航到所在周（V15 delivery guard 不影响历史导航）", () => {
    seedBase({ week: 4 });
    actSet({ studyBlocks: [{ id: "sb-rel", title: "旧计划", date: WEEK10_MON, startTime: "14:00", endTime: "15:00", assignmentId: "a-1", planningState: "released" }] });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "studyBlock", targetId: "sb-rel" }));
    expect(result).toBe("study-block");
    expect(useAppStore.getState().currentSemesterWeek).toBe(10);
  });

  it("stale StudyBlock → no-op", () => {
    seedBase();
    expect(
      navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "studyBlock", targetId: "sb-gone" }))
    ).toBe("stale");
    expect(useAppStore.getState().activeTab).toBe("overview");
  });
});

function actSet(partial: Record<string, unknown>) {
  useAppStore.setState(partial as never);
}

describe("navigateReminderTarget — StudyBlock out-of-semester fallback", () => {
  const OLD_DATE = "2025-01-06"; // 学期外

  it("linked block 学期外：不 clamp（week/tab 保持）→ 打开 parent Assignment", () => {
    seedBase({ week: 4 });
    actSet({
      studyBlocks: [{ id: "sb-old", title: "旧学期计划", date: OLD_DATE, startTime: "10:00", endTime: "11:00", assignmentId: "a-1" }],
    });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "studyBlock", targetId: "sb-old" }));
    expect(result).toBe("fallback-assignment");
    const s = useAppStore.getState();
    expect(s.currentSemesterWeek).toBe(4); // 未 clamp
    expect(s.activeTab).toBe("overview"); // 未改变
    expect(s.selectedAssignmentId).toBe("a-1");
  });

  it("standalone block 学期外：no-op，不虚构 Assignment", () => {
    seedBase({ week: 4 });
    actSet({
      studyBlocks: [{ id: "sb-free-old", title: "自由旧计划", date: OLD_DATE, startTime: "10:00", endTime: "11:00" }],
    });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "studyBlock", targetId: "sb-free-old" }));
    expect(result).toBe("out-of-semester");
    const s = useAppStore.getState();
    expect(s.currentSemesterWeek).toBe(4);
    expect(s.selectedAssignmentId).toBeNull();
  });
});

describe("navigateReminderTarget — calendarMark", () => {
  it.each([
    ["exam"],
    ["activity"],
    ["ddl"],
  ] as const)("independent %s：Drawer selection + 精确周（第 8 周）", (type) => {
    seedBase({ week: 2 });
    const markId = `mk-${type}`;
    actSet({
      calendarMarks: [
        { id: markId, date: "2026-04-27", type, title: `${type} 事件`, startTime: "14:00", endTime: "16:00" } as unknown as CalendarMark,
      ],
    }); // 2026-04-27 = 第 8 周周一
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "calendarMark", targetId: markId }));
    expect(result).toBe("calendar-mark");
    const s = useAppStore.getState();
    expect(s.selectedCalendarMarkId).toBe(markId);
    expect(s.currentSemesterWeek).toBe(8);
    expect(s.activeTab).toBe("timetable");
  });

  it("independent mark 学期外：selection 保持、week/tab 不 clamp；Drawer 可打开", () => {
    seedBase({ week: 3 });
    actSet({
      calendarMarks: [
        { id: "mk-old", date: "2025-06-01", type: "exam", title: "旧学期考试" } as unknown as CalendarMark,
      ],
    });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "calendarMark", targetId: "mk-old" }));
    expect(result).toBe("out-of-semester");
    const s = useAppStore.getState();
    expect(s.selectedCalendarMarkId).toBe("mk-old"); // Drawer 仍可打开
    expect(s.currentSemesterWeek).toBe(3); // 未 clamp
    expect(s.activeTab).toBe("overview"); // 未改变
  });

  it("linked DDL mark（sourceId → 真实 Assignment）→ Assignment owner；不写 selectedCalendarMarkId；tab 保持", () => {
    seedBase({ week: 4 });
    actSet({
      calendarMarks: [
        { id: "mk-linked", date: WEEK10_MON.slice(0, 10 - 0), type: "ddl", title: "实证报告 DDL", sourceId: "a-1" } as unknown as CalendarMark,
      ],
    });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "calendarMark", targetId: "mk-linked" }));
    expect(result).toBe("assignment");
    const s = useAppStore.getState();
    expect(s.selectedAssignmentId).toBe("a-1");
    expect(s.selectedCalendarMarkId).toBeNull(); // canonical owner regression
    expect(s.activeTab).toBe("overview");
  });

  it("stale sourceId：不按 title/date 猜——mark 仍存在则按 Independent 处理", () => {
    seedBase({ week: 4 });
    actSet({
      calendarMarks: [
        { id: "mk-orphan", date: "2026-04-27", type: "ddl", title: "孤儿 DDL", sourceId: "a-gone" } as unknown as CalendarMark,
      ],
    });
    const result = navigateReminderTarget(mkReminder({ id: `r${seedSeq}`, targetType: "calendarMark", targetId: "mk-orphan" }));
    const s = useAppStore.getState();
    expect(s.selectedAssignmentId).toBeNull();
    expect(s.selectedCalendarMarkId).toBe("mk-orphan"); // Independent Detail
    void result;
  });
});

describe("navigateReminderTarget — standalone", () => {
  it("standalone → 注入的 onStandalone 被调用（helper 不依赖 Center store）", () => {
    seedBase();
    const onStandalone = vi.fn();
    const r = mkReminder({ id: `r${seedSeq}`, targetType: "standalone", targetId: undefined });
    expect(navigateReminderTarget(r, { onStandalone })).toBe("standalone");
    expect(onStandalone).toHaveBeenCalledWith(r);
  });
});

// ============================================================
// 三 surface 一致性 + read semantics（轻量集成）
// ============================================================
describe("Surface delegation & read semantics", () => {
  function seedWithReminder(target: Partial<Reminder>): Reminder {
    seedBase({ week: 4 });
    const reminder = mkReminder({ id: `r-surface-${seedSeq}`, triggerAt: `${WEEK4_MON}T08:00:00`, ...target });
    useAppStore.setState({ reminders: [reminder] });
    return reminder;
  }

  it("ReminderCenter item click → shared navigation（studyBlock 精确周）+ Center 关闭", async () => {
    const { ReminderCenter } = await import("@/components/reminders/ReminderCenter");
    const reminder = seedWithReminder({ targetType: "studyBlock", targetId: "sb-w10" });
    useReminderCenterStore.getState().open();
    render(<ReminderCenter />);
    const row = screen.getByText(reminder.title);
    fireEvent.click(row);
    const s = useAppStore.getState();
    expect(s.currentSemesterWeek).toBe(10); // 与 helper 直接调用一致
    expect(s.activeTab).toBe("timetable");
    expect(useReminderCenterStore.getState().isOpen).toBe(false);
    void reminder;
    cleanup();
  });

  it("ReminderViewport card click → readAt 写入 + shared navigation（assignment）", async () => {
    const { ReminderViewport } = await import("@/components/reminders/ReminderViewport");
    const { useReminderDeliveryStore } = await import("@/store/useReminderDeliveryStore");
    const reminder = seedWithReminder({ targetType: "assignment", targetId: "a-gone" }); // stale 也要 read
    actSet({}); // noop
    useReminderDeliveryStore.setState({ queue: [reminder.id] });
    render(<ReminderViewport />);
    fireEvent.click(screen.getByLabelText(`查看提醒：${reminder.title}`));
    const stored = useAppStore.getState().reminders.find((r) => r.id === reminder.id)!;
    expect(stored.readAt).toBeTruthy(); // navigation 失败不影响 read semantics
    expect(useAppStore.getState().selectedAssignmentId).toBeNull(); // stale 不写 selection
  }, 20000);

  it("Browser Notification click → markRead + shared navigation（studyBlock 精确周）", async () => {
    vi.useFakeTimers({ now: NOW_BASE });
    try {
      // persist hydrate 先于 seed（否则 rehydrate 覆盖种子）
      await act(async () => {
        await useAppStore.persist.rehydrate();
      });
      const reminder = seedWithReminder({ targetType: "studyBlock", targetId: "sb-w10", triggerAt: "2026-03-10T12:00:30", status: "scheduled" as never });
      const { useReminderPreferencesStore } = await import("@/store/useReminderPreferencesStore");
      useReminderPreferencesStore.setState({ browserNotificationsEnabled: true });
      render(<ReminderRuntime />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const mock = showBrowserReminderNotification as unknown as ReturnType<typeof vi.fn>;
      expect(mock.mock.calls.length).toBeGreaterThan(0);
      const onClick = mock.mock.calls.at(-1)?.[0]?.onClick as (() => void) | undefined;
      expect(typeof onClick).toBe("function");
      onClick!();
      const stored = useAppStore.getState().reminders.find((r) => r.id === reminder.id)!;
      expect(stored.readAt).toBeTruthy();
      expect(useAppStore.getState().currentSemesterWeek).toBe(10);
      expect(useAppStore.getState().activeTab).toBe("timetable");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  }, 20000);

  it("静态契约：三处 surface 文件只调用 shared helper，不再各自写 navigation setter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const f of ["components/reminders/ReminderRuntime.tsx", "components/reminders/ReminderViewport.tsx", "components/reminders/ReminderCenter.tsx"]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).toContain("navigateReminderTarget");
      // drift vector：surface 内禁止直接写导航 state（canonical routing 只在 reminderNavigation.ts）
      expect(src).not.toMatch(/setSelectedAssignmentId\(/);
      expect(src).not.toMatch(/setSelectedCalendarMarkId\(/);
      expect(src).not.toMatch(/setActiveTab\(./);
    }
  });
});
