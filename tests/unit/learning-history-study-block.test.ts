import { describe, it, expect, beforeEach, vi } from "vitest";
import { StudyBlock } from "@/types";
import {
  buildStudyBlockCreatedEvent,
  buildStudyBlockDeletedEvent,
  buildStudyBlockUpdatedEvent,
  studyBlockPlannedMinutes,
} from "@/lib/history/studyBlockEvents";
import { resolveLearningMutationContext, flushLearningHistoryQueue } from "@/lib/history/recorder";
import { clearLearningHistoryStorage } from "@/lib/history/store";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };
const CTX = resolveLearningMutationContext({ source: "manual" });

function mkBlock(patch: Partial<StudyBlock>): StudyBlock {
  return {
    id: "sb1",
    title: "学习计划",
    date: "2026-08-15",
    startTime: "10:00",
    endTime: "11:30",
    ...patch,
  } as StudyBlock;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("studyBlockPlannedMinutes", () => {
  it("end > start → 分钟数；非法/倒置 → null（不返回负数）", () => {
    expect(studyBlockPlannedMinutes({ startTime: "10:00", endTime: "11:30" })).toBe(90);
    expect(studyBlockPlannedMinutes({ startTime: "11:30", endTime: "10:00" })).toBeNull();
    expect(studyBlockPlannedMinutes({ startTime: "bad", endTime: "11:30" })).toBeNull();
    expect(studyBlockPlannedMinutes({ startTime: "10:00", endTime: "10:00" })).toBeNull();
  });
});

describe("StudyBlock History Events", () => {
  it("created：记录时间与 plannedMinutes + originSource", () => {
    const event = buildStudyBlockCreatedEvent({ block: mkBlock({}), context: CTX, environment: ENV });
    expect(event.type).toBe("study_block.created");
    expect((event as { data: { date: string; plannedMinutes: number; originSource: string } }).data).toMatchObject({
      date: "2026-08-15",
      plannedMinutes: 90,
      originSource: "manual",
    });
  });

  it("created：kiro source → originSource=kiro", () => {
    const event = buildStudyBlockCreatedEvent({
      block: mkBlock({ source: "kiro" }),
      context: CTX,
      environment: ENV,
    });
    expect((event as { data: { originSource: string } }).data.originSource).toBe("kiro");
  });

  it("updated：date/startTime/endTime 变化 → 记录；仅 title 变化 → null", () => {
    const moved = buildStudyBlockUpdatedEvent({
      before: mkBlock({}),
      after: mkBlock({ date: "2026-08-16", startTime: "14:00" }),
      context: CTX,
      environment: ENV,
    });
    expect(moved).not.toBeNull();
    expect(moved!.type).toBe("study_block.updated");
    const titleOnly = buildStudyBlockUpdatedEvent({
      before: mkBlock({}),
      after: mkBlock({ title: "新标题" }),
      context: CTX,
      environment: ENV,
    });
    expect(titleOnly).toBeNull();
  });

  it("deleted：记录 date", () => {
    const event = buildStudyBlockDeletedEvent({ block: mkBlock({}), context: CTX, environment: ENV });
    expect(event.type).toBe("study_block.deleted");
    expect((event as { data: { date: string } }).data.date).toBe("2026-08-15");
  });
});

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 },
    courses: [],
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
      defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440,
    },
    reminders: [],
    focusSessions: [],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("StudyBlock Store Integration", () => {
  it("addStudyBlock → study_block.created；updateStudyBlock 时间变化 → updated；仅 title 变化不记录；delete → deleted", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addStudyBlock({ title: "计划", date: "2026-08-15", startTime: "10:00", endTime: "11:30" });
    store.getState().updateStudyBlock(id, { title: "改名" });
    store.getState().updateStudyBlock(id, { startTime: "14:00" });
    store.getState().deleteStudyBlock(id);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve((req.result as { type: string; sequence: number }[]).slice().sort((a, b) => a.sequence - b.sequence));
      req.onerror = () => reject(req.error);
    });
    expect(events.map((e) => e.type)).toEqual([
      "study_block.created",
      "study_block.updated",
      "study_block.deleted",
    ]);
  });
});
