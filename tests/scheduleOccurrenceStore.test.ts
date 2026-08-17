import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { ScheduleOccurrenceOverride } from "@/types";
import { validateBackup } from "@/lib/backup";
import { ClassFlowBackupData } from "@/types";

const KEY = "classflow-storage-v2";

function mkData(over: Partial<ClassFlowBackupData> = {}): ClassFlowBackupData {
  return {
    userProfile: { name: "张同学", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
    semester: { id: "sem_bak", name: "备份学期", startDate: "2026-02-23", totalWeeks: 16 },
    courses: [
      { id: "c_1", name: "数据结构", code: "CS-210", teacher: "李教授", classroom: "计算机楼102", credit: 4, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] },
    ],
    schedules: [{ id: "s_1", courseId: "c_1", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教101", weeks: "1-16周" }],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    ...over,
  };
}

const cancelW6: ScheduleOccurrenceOverride = { id: "occ_c", kind: "cancel", courseId: "c_1", baseScheduleId: "s_1", week: 6 };
const moveW6: ScheduleOccurrenceOverride = { id: "occ_m", kind: "move", courseId: "c_1", baseScheduleId: "s_1", week: 6, dayOfWeek: 6, startTime: "14:00", endTime: "15:40", location: "计算机楼302" };
const extraW7: ScheduleOccurrenceOverride = { id: "occ_e", kind: "extra", courseId: "c_1", week: 7, dayOfWeek: 7, startTime: "19:00", endTime: "20:00", location: "教201" };

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("Schedule Occurrence Override：Store / Persist / Backup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("旧持久化数据缺失 scheduleOccurrenceOverrides → 恢复为 []（backward compatible）", async () => {
    const legacy = {
      version: 7,
      state: {
        userProfile: mkData().userProfile,
        semester: mkData().semester,
        courses: mkData().courses,
        schedules: mkData().schedules,
        assignments: [],
        calendarMarks: [],
        groupProjects: [],
      },
    };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const store = await freshStore();
    expect(store.getState().scheduleOccurrenceOverrides).toEqual([]);
    expect(store.getState().schedules).toHaveLength(1); // 既有 schedules 不被 wipe
  });

  it("新 override 持久化：restore 后 localStorage 包含且 reload 保留", async () => {
    const store = await freshStore();
    store.getState().restoreAppData(mkData());
    const r = store.getState().addScheduleOccurrenceOverride({
      kind: "move",
      courseId: "c_1",
      baseScheduleId: "s_1",
      week: 6,
      dayOfWeek: 6,
      startTime: "14:00",
      endTime: "15:40",
      location: "计算机楼302",
    });
    expect(r.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 0));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.state.scheduleOccurrenceOverrides).toHaveLength(1);
    expect(raw.state.scheduleOccurrenceOverrides[0].baseScheduleId).toBe("s_1");

    const store2 = await freshStore();
    expect(store2.getState().scheduleOccurrenceOverrides).toHaveLength(1);
  });

  it("备份 roundtrip：新备份可校验 + restoreAppData 恢复 override；旧备份缺失 → []", async () => {
    const data = mkData({ scheduleOccurrenceOverrides: [cancelW6, extraW7] });
    const v = validateBackup({ version: 1, exportedAt: "x", data });
    expect(v.ok).toBe(true);

    const store = await freshStore();
    store.getState().restoreAppData(data);
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(2);

    const legacy = validateBackup({ version: 1, exportedAt: "x", data: mkData() });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const store2 = await freshStore();
    store2.getState().restoreAppData(legacy.data);
    expect(store2.getState().scheduleOccurrenceOverrides).toEqual([]);
  });

  it("删除课程 → 其 override 全部级联删除（restore 可恢复）", async () => {
    const store = await freshStore();
    store.getState().restoreAppData(mkData({ scheduleOccurrenceOverrides: [cancelW6, moveW6, extraW7] }));
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(3);
    store.getState().deleteCourse("c_1");
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(0);
  });

  it("删除 base schedule → cancel/move override 同步删除；extra（无 baseScheduleId）保留", async () => {
    const store = await freshStore();
    store.getState().restoreAppData(mkData({ scheduleOccurrenceOverrides: [cancelW6, moveW6, extraW7] }));
    store.getState().deleteSchedule("s_1");
    const remaining = store.getState().scheduleOccurrenceOverrides;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].kind).toBe("extra");
  });

  it("delete + restore override（原 ID）；replace 原子替换同 slot 旧 override", async () => {
    const store = await freshStore();
    store.getState().restoreAppData(mkData());
    const r = store.getState().addScheduleOccurrenceOverride({
      kind: "move",
      courseId: "c_1",
      baseScheduleId: "s_1",
      week: 6,
      dayOfWeek: 6,
      startTime: "14:00",
      endTime: "15:40",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const removed = store.getState().deleteScheduleOccurrenceOverride(r.id);
    expect(removed?.id).toBe(r.id);
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(0);
    store.getState().restoreScheduleOccurrenceOverride(removed!);
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(1);

    // replace：同 baseScheduleId+week 的旧 move 被替换（不叠加）
    const rep = store.getState().replaceScheduleOccurrenceOverride({
      kind: "move",
      courseId: "c_1",
      baseScheduleId: "s_1",
      week: 6,
      dayOfWeek: 5,
      startTime: "18:00",
      endTime: "19:00",
    });
    expect(rep.ok).toBe(true);
    const all = store.getState().scheduleOccurrenceOverrides;
    expect(all).toHaveLength(1);
    expect((all[0] as Extract<ScheduleOccurrenceOverride, { kind: "move" }>).dayOfWeek).toBe(5);
  });

  it("move 与另一课程冲突 → 拒绝创建；与自身 original 重叠 → 允许", async () => {
    const store = await freshStore();
    store.getState().restoreAppData(mkData());
    store.getState().addScheduleSlot({ courseId: "c_1", dayOfWeek: 6, startTime: "14:00", endTime: "15:40", location: "教101", weeks: "1-16周" });
    // 同课程自身 slot 冲突（course ↔ course 硬冲突）→ move 到该时间被拒
    const bad = store.getState().addScheduleOccurrenceOverride({
      kind: "move",
      courseId: "c_1",
      baseScheduleId: "s_1",
      week: 6,
      dayOfWeek: 6,
      startTime: "14:00",
      endTime: "15:40",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("CONFLICT");
    // 与自身 original（周三 10:00）重叠 → 允许（替换语义）
    const ok = store.getState().addScheduleOccurrenceOverride({
      kind: "move",
      courseId: "c_1",
      baseScheduleId: "s_1",
      week: 6,
      dayOfWeek: 3,
      startTime: "10:00",
      endTime: "11:40",
    });
    expect(ok.ok).toBe(true);
  });
});
