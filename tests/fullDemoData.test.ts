import { it, expect } from "vitest";
import { buildFullDemoData } from "@/lib/dev/fullDemoData";
import { useAppStore } from "@/store/useAppStore";
import { isBackfillableFocusSession } from "@/lib/history/migration";
import { getSemesterWeek } from "@/lib/semester";

it("全新预览数据集 Showcase V1：一学期纵深全模块形状", () => {
  const data = buildFullDemoData();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const localToday = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();
  expect(data.courses).toHaveLength(10);
  expect(data.schedules).toHaveLength(17);
  expect(data.assignments).toHaveLength(30);
  expect(data.calendarMarks!.length).toBeGreaterThanOrEqual(30);
  expect(data.studyBlocks).toHaveLength(18);
  expect(data.groupProjects).toHaveLength(3);
  expect(data.reminders).toHaveLength(7);
  expect(data.focusSessions).toHaveLength(35);
  expect(data.scheduleOccurrenceOverrides).toHaveLength(3);
  // 作息方案随备份类型一起带入
  expect(data.bellSchedules).toHaveLength(2);
  expect(data.activeBellScheduleId).toBe("bell-1");
  // 不覆盖用户偏好
  expect(data.preferences).toBeUndefined();

  // 学期：一学期纵深（当前约第 11 周，共 18 周）
  expect(data.semester.totalWeeks).toBe(18);
  const currentWeek = getSemesterWeek(new Date(), data.semester);
  expect(currentWeek).toBeGreaterThanOrEqual(10);
  expect(currentWeek).toBeLessThanOrEqual(12);

  const materials = data.courses.flatMap((c) => c.materials);
  expect(materials.length).toBe(23);
  expect(new Set(materials.map((m) => m.type))).toEqual(new Set(["pdf", "link", "ppt", "doc"]));
  expect(materials.filter((m) => m.type === "link").every((m) => !!m.url)).toBe(true);
  expect(new Set(data.courses.map((c) => c.id)).size).toBe(10);

  // 任务：归档（过去）、逾期、今天、未来、无 DDL 全覆盖；预计耗时与子任务/资料关联
  const archived = data.assignments.filter((a) => a.status === "completed" || a.status === "submitted");
  expect(archived.length).toBeGreaterThanOrEqual(9);
  const overdue = data.assignments.filter(
    (a) => a.ddl && a.ddl.slice(0, 10) < localToday && a.status !== "completed" && a.status !== "submitted"
  );
  expect(overdue.length).toBeGreaterThanOrEqual(2);
  const today = data.assignments.filter((a) => a.ddl && a.ddl.slice(0, 10) === localToday);
  expect(today.length).toBeGreaterThanOrEqual(2);
  const noDdl = data.assignments.filter((a) => !a.ddl);
  expect(noDdl.length).toBeGreaterThanOrEqual(4);
  expect(data.assignments.some((a) => a.estimatedMinutes === undefined)).toBe(true);
  expect(data.assignments.some((a) => a.subtasks && a.subtasks.length > 0)).toBe(true);
  expect(data.assignments.some((a) => a.materialIds && a.materialIds.length > 0)).toBe(true);
  expect(data.assignments.some((a) => a.autoReminderDisabled === true)).toBe(true);
  // 重复系列三代同堂
  const series = data.assignments.filter((a) => a.recurrenceSeriesId === "rs_demo_1");
  expect(series.length).toBe(3);
  expect(series.every((a) => a.recurrence === "weekly")).toBe(true);
  expect(series.some((a) => a.recurrenceParentId)).toBe(true);

  const marks = data.calendarMarks!;
  expect(marks.filter((m) => m.type === "ddl").every((m) => !!m.sourceId)).toBe(true);
  expect(marks.filter((m) => m.type !== "ddl").every((m) => !!m.startTime && !!m.endTime)).toBe(true);
  expect(marks.filter((m) => m.type === "exam").length).toBeGreaterThanOrEqual(3);
  expect(marks.filter((m) => m.type === "activity").length).toBeGreaterThanOrEqual(2);
  expect(marks.some((m) => m.date < localToday)).toBe(true); // 历史月份

  const blocks = data.studyBlocks ?? [];
  expect(blocks.filter((b) => b.assignmentId === "a24")).toHaveLength(2); // 多段计划
  expect(blocks.some((b) => b.date < localToday)).toBe(true); // 历史计划
  expect(blocks.some((b) => b.date > localToday)).toBe(true); // 未来计划

  // 专注会话：全部 completed 可 backfill（除 1 个 paused）；覆盖 10 门课程、多时段
  const completed = data.focusSessions!.filter((f) => isBackfillableFocusSession(f));
  expect(completed.length).toBe(34);
  expect(data.focusSessions!.some((f) => f.status === "paused")).toBe(true);
  expect(new Set(completed.map((f) => f.courseId)).size).toBeGreaterThanOrEqual(8);
  const hours = new Set(completed.map((f) => new Date(f.startedAt).getHours()));
  expect(hours.size).toBeGreaterThanOrEqual(4);
  // Domain 契约：actualActiveMs ≤ plannedMs
  for (const f of completed) {
    expect(f.actualActiveMs!).toBeLessThanOrEqual(f.plannedMinutes * 60_000);
  }

  // 排课例外：本周 cancel / move / extra 各 1
  expect(data.scheduleOccurrenceOverrides!.map((o) => o.kind).sort()).toEqual(["cancel", "extra", "move"]);
  expect(data.scheduleOccurrenceOverrides!.every((o) => o.week === currentWeek)).toBe(true);

  // 提醒：四种 targetType 全覆盖 + fired/skipped 历史 + 三种 source
  expect(new Set(data.reminders!.map((r) => r.targetType))).toEqual(
    new Set(["assignment", "studyBlock", "standalone", "calendarMark"])
  );
  expect(data.reminders!.some((r) => r.status === "fired")).toBe(true);
  expect(data.reminders!.some((r) => r.status === "skipped")).toBe(true);
  expect(new Set(data.reminders!.map((r) => r.source))).toEqual(new Set(["manual", "kiro", "auto"]));
});

it("restoreAppData 归一化后全模块可用（含作息方案）", () => {
  const store = useAppStore.getState();
  store.restoreAppData(buildFullDemoData());
  const s = useAppStore.getState();
  expect(s.courses).toHaveLength(10);
  expect(s.schedules).toHaveLength(17);
  expect(s.assignments).toHaveLength(30);
  expect(s.groupProjects).toHaveLength(3);
  expect(s.studyBlocks).toHaveLength(18);
  expect(s.focusSessions).toHaveLength(35);
  expect(s.reminders!.length).toBeGreaterThanOrEqual(7);
  expect(s.scheduleOccurrenceOverrides).toHaveLength(3);
  expect(s.bellSchedules).toHaveLength(2);
  expect(s.activeBellScheduleId).toBe("bell-1");
  expect(s.calendarMarks.filter((m) => m.type === "ddl").every((m) => !!m.sourceId)).toBe(true);
  // 资料关联有效：materialIds 必须指向所属课程真实存在的材料
  for (const a of s.assignments) {
    if (a.materialIds) {
      const course = s.courses.find((c) => c.id === a.courseId);
      expect(course, `assignment ${a.id}`).toBeTruthy();
      for (const mid of a.materialIds) {
        expect(course!.materials.some((m) => m.id === mid), `${a.id} → ${mid}`).toBe(true);
      }
    }
  }
  // 提醒引用有效（含 calendarMark）
  for (const r of s.reminders ?? []) {
    if (r.targetType === "assignment") {
      expect(s.assignments.some((a) => a.id === r.targetId), `reminder ${r.id}`).toBe(true);
    }
    if (r.targetType === "studyBlock") {
      expect(s.studyBlocks.some((b) => b.id === r.targetId), `reminder ${r.id}`).toBe(true);
    }
    if (r.targetType === "calendarMark") {
      expect(s.calendarMarks.some((m) => m.id === r.targetId), `reminder ${r.id}`).toBe(true);
    }
  }
  // 重复链在归一化后保持
  const series = s.assignments.filter((a) => a.recurrenceSeriesId === "rs_demo_1");
  expect(series.length).toBe(3);
});
