import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import {
  buildCourseOverlapScheduleFingerprint,
  findUnapprovedCourseOverlaps,
  StudyBlockCourseOverlapApproval,
} from "@/lib/planning/courseOverlapPolicy";
import { validateBackup } from "@/lib/backup";

const KEY = "classflow-storage-v2";

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function mondayStr(offset: number): string {
  const d = new Date();
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() + offset - (dow - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seedState(overrides: { schedules?: unknown[]; studyBlocks?: unknown[]; assignments?: unknown[] } = {}) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: mondayStr(0), totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "王老师", classroom: "教101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules:
      overrides.schedules ??
      [
        { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "10:00", endTime: "12:00", location: "教101", weeks: "1-16周" },
        { id: "s2", courseId: "c1", dayOfWeek: 1, startTime: "14:00", endTime: "16:00", location: "教102", weeks: "1-16周" },
      ],
    assignments:
      overrides.assignments ??
      [
        { id: "a1", courseId: "c1", title: "数据库报告", description: "", priority: "medium", status: "todo", progress: 0, tags: [], estimatedMinutes: 90 },
        { id: "a2", courseId: "c1", title: "计量经济学作业", description: "", priority: "high", status: "doing", progress: 10, tags: [], estimatedMinutes: 120 },
      ],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: overrides.studyBlocks ?? [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 4, state }));
}

async function fresh() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const applyMod = await import("@/lib/planning/applyStudyPlan");
  const rebalanceMod = await import("@/lib/planning/applyStudyRebalance");
  return { store: storeMod.useAppStore, apply: applyMod, rebalance: rebalanceMod };
}

beforeEach(() => {
  localStorage.clear();
});

describe("Study Plan Apply Approval 持久化（V1.1 §55/56/57）", () => {
  it("未批准 → needs-approval 0 mutation；批准 → 只给实际 overlap 的 Block 保存 Approval（含 fingerprint + approvedAt）", async () => {
    seedState();
    const { store, apply } = await fresh();
    const input = { blocks: [{ assignmentId: "a2", title: "作业", date: mondayStr(0), startTime: "10:30", endTime: "11:30", courseId: "c1" }] };
    const r = apply.applyStudyPlan(input, store.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(store.getState().studyBlocks.length).toBe(0);

    const approved = apply.applyStudyPlan(input, store.getState(), { allowCourseOverlap: true, now: 12345 });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.state !== "created") return;
    const b = store.getState().studyBlocks[0];
    expect(b.source).toBe("kiro");
    expect(b.courseOverlapApprovals).toEqual([
      { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(store.getState().schedules[0] as never), approvedAt: 12345 },
    ]);
  });

  it("§56 multi-overlap：一个 Block 同时与 S1/S2 重叠 → 保存两个 Approval", async () => {
    seedState();
    const { store, apply } = await fresh();
    // 08:00–17:00 跨两个课程时段（S1 10-12, S2 14-16）
    const input = { blocks: [{ assignmentId: "a2", title: "作业", date: mondayStr(0), startTime: "11:00", endTime: "15:00", courseId: "c1" }] };
    const r = apply.applyStudyPlan(input, store.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(r.courseOverlaps).toHaveLength(2);
    const approved = apply.applyStudyPlan(input, store.getState(), { allowCourseOverlap: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.state !== "created") return;
    const b = store.getState().studyBlocks[0];
    expect(b.courseOverlapApprovals).toHaveLength(2);
    expect(b.courseOverlapApprovals!.map((a) => a.scheduleId).sort()).toEqual(["s1", "s2"]);
  });

  it("§57 mixed batch：Block A overlap、Block B normal → 只有 A 有 Approval", async () => {
    seedState();
    const { store, apply } = await fresh();
    const input = {
      blocks: [
        { assignmentId: "a2", title: "重叠块", date: mondayStr(0), startTime: "10:30", endTime: "11:30", courseId: "c1" },
        { assignmentId: "a1", title: "普通块", date: mondayStr(0), startTime: "16:30", endTime: "17:30", courseId: "c1" },
      ],
    };
    const r = apply.applyStudyPlan(input, store.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(r.courseOverlaps).toHaveLength(1);
    const approved = apply.applyStudyPlan(input, store.getState(), { allowCourseOverlap: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.state !== "created") return;
    const blocks = store.getState().studyBlocks;
    const a = blocks.find((b) => b.title === "重叠块")!;
    const n = blocks.find((b) => b.title === "普通块")!;
    expect(a.courseOverlapApprovals).toHaveLength(1);
    expect(n.courseOverlapApprovals).toBeUndefined();
  });
});

describe("Store mutation reconcile（V1.1 §60/61）", () => {
  it("§60 manual 拖动到课程 → 自动 Approval（approvedAt = occurredAt）；之后 Rebalance 尊重", async () => {
    seedState({ studyBlocks: [
      { id: "sb1", title: "作业", date: mondayStr(0), startTime: "13:00", endTime: "14:00", assignmentId: "a2", courseId: "c1", source: "kiro" },
    ]});
    const { store } = await fresh();
    store.getState().updateStudyBlock(
      "sb1",
      { date: mondayStr(0), startTime: "10:30", endTime: "11:30" }, // 拖入 S1 10-12
      { source: "manual", occurredAt: 777 }
    );
    const b = store.getState().studyBlocks[0];
    expect(b.courseOverlapApprovals).toEqual([
      { scheduleId: "s1", scheduleFingerprint: expect.any(String) as never, approvedAt: 777 },
    ]);
    // 之后 Rebalance：不得因 course_conflict 移动（approved 生效）
    const { rebalance } = await fresh();
    const engine = await import("@/lib/planning/studyRebalance");
    const r = engine.proposeStudyRebalance({
      assignments: store.getState().assignments as never,
      studyBlocks: store.getState().studyBlocks as never,
      schedules: store.getState().schedules as never,
      calendarMarks: store.getState().calendarMarks as never,
      semester: store.getState().semester,
      currentSemesterWeek: store.getState().currentSemesterWeek,
      horizonDays: 7,
      now: new Date(),
    });
    expect(r.moves.filter((m) => m.reason === "course_conflict")).toHaveLength(0);
  });

  it("§61 kiro 时间更新到课程重叠 → 不自动创建 Approval", async () => {
    seedState({ studyBlocks: [
      { id: "sb1", title: "作业", date: mondayStr(0), startTime: "13:00", endTime: "14:00", assignmentId: "a2", courseId: "c1", source: "kiro" },
    ]});
    const { store } = await fresh();
    store.getState().updateStudyBlock("sb1", { date: mondayStr(0), startTime: "10:30", endTime: "11:30" }, { source: "kiro" });
    expect(store.getState().studyBlocks[0].courseOverlapApprovals).toBeUndefined();
  });
});

describe("Rebalance Apply / Undo Approval 快照（V1.1 §62/39/40/41）", () => {
  it("§62 原 approved overlap → Rebalance 移到正常时间 → Approval 清空；Undo 恢复原时间 + 原 Approval", async () => {
    const fp = buildCourseOverlapScheduleFingerprint({
      id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "10:00", endTime: "12:00", location: "教101", weeks: "1-16周",
    });
    seedState({ studyBlocks: [
      { id: "sb1", title: "作业", date: mondayStr(0), startTime: "10:30", endTime: "11:30", assignmentId: "a2", courseId: "c1", source: "kiro",
        courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 }] },
    ]});
    const { store, rebalance } = await fresh();
    const move = {
      blockId: "sb1",
      from: { date: mondayStr(0), startTime: "10:30", endTime: "11:30" },
      to: { date: mondayStr(1), startTime: "19:00", endTime: "20:00" },
    };
    const applied = rebalance.applyStudyRebalance([move], store.getState());
    if (!applied.ok) {
      throw new Error(`apply failed: ${applied.code} ${applied.message} ${JSON.stringify(applied.details)}`);
    }
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.state !== "applied") return;
    expect(applied.originalApprovals.sb1).toEqual([
      { scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 },
    ]);
    const after = store.getState().studyBlocks[0];
    expect(after.date).toBe(mondayStr(1));
    expect(after.courseOverlapApprovals).toBeUndefined(); // 目标无重叠 → 清空

    const undone = rebalance.undoStudyRebalance([move], store.getState(), {
      originalApprovals: applied.originalApprovals,
      afterApprovals: applied.afterApprovals,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok || undone.state !== "applied") return;
    const restored = store.getState().studyBlocks[0];
    expect(restored.date).toBe(mondayStr(0));
    expect(restored.startTime).toBe("10:30");
    expect(restored.courseOverlapApprovals).toEqual([
      { scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 },
    ]);
  });

  it("§41 stale undo：Apply 后用户重新确认了课程重叠 → Undo 拒绝且保持现状", async () => {
    seedState({ studyBlocks: [
      { id: "sb1", title: "作业", date: mondayStr(0), startTime: "13:00", endTime: "14:00", assignmentId: "a2", courseId: "c1", source: "kiro" },
    ]});
    const { store, rebalance } = await fresh();
    const move = {
      blockId: "sb1",
      from: { date: mondayStr(0), startTime: "13:00", endTime: "14:00" },
      to: { date: mondayStr(1), startTime: "19:00", endTime: "20:00" },
    };
    const applied = rebalance.applyStudyRebalance([move], store.getState());
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.state !== "applied") return;
    // 用户把 block 拖回课程时间（手动 → 自动批准）
    store.getState().updateStudyBlock("sb1", { date: mondayStr(0), startTime: "10:30", endTime: "11:30" }, { source: "manual", occurredAt: 999 });
    const undone = rebalance.undoStudyRebalance([move], store.getState(), { originalApprovals: applied.originalApprovals });
    expect(undone.ok).toBe(false);
    if (!undone.ok) {
      expect(undone.code).toBe("STALE_PROPOSAL");
    }
    // 用户意图保持
    expect(store.getState().studyBlocks[0].startTime).toBe("10:30");
    expect(store.getState().studyBlocks[0].courseOverlapApprovals).toBeDefined();
  });
});

describe("Backup（V1.1 §65/66）", () => {
  it("带 Approval 的 StudyBlock 能 export/restore 且 Rebalance 仍尊重", async () => {
    const fp = buildCourseOverlapScheduleFingerprint({
      id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "10:00", endTime: "12:00", location: "教101", weeks: "1-16周",
    });
    seedState({ studyBlocks: [
      { id: "sb1", title: "作业", date: mondayStr(0), startTime: "10:30", endTime: "11:30", assignmentId: "a2", courseId: "c1", source: "kiro",
        courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 }] },
    ]});
    const { store } = await fresh();
    // 模拟 backup export（validateBackup 接受 { version: 1, data }）→ restore
    const snapshot = store.getState();
    const backupData = {
      userProfile: snapshot.userProfile,
      semester: snapshot.semester,
      courses: snapshot.courses,
      schedules: snapshot.schedules,
      assignments: snapshot.assignments,
      calendarMarks: snapshot.calendarMarks,
      groupProjects: snapshot.groupProjects,
      studyBlocks: snapshot.studyBlocks,
    };
    const validated = validateBackup({ version: 1, data: backupData } as never);
    expect(validated.ok).toBe(true);
    // restore 语义：直接写回 store
    useAppStore.setState({ ...backupData } as never);
    const restored = useAppStore.getState().studyBlocks[0];
    expect(restored.courseOverlapApprovals).toEqual([
      { scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 },
    ]);
    // 之后 Rebalance 仍尊重 Approval
    const engine = await import("@/lib/planning/studyRebalance");
    const r = engine.proposeStudyRebalance({
      assignments: useAppStore.getState().assignments as never,
      studyBlocks: useAppStore.getState().studyBlocks as never,
      schedules: useAppStore.getState().schedules as never,
      calendarMarks: useAppStore.getState().calendarMarks as never,
      semester: useAppStore.getState().semester,
      currentSemesterWeek: useAppStore.getState().currentSemesterWeek,
      horizonDays: 7,
      now: new Date(),
    });
    expect(r.moves.filter((m) => m.reason === "course_conflict")).toHaveLength(0);
  });

  it("§66 旧备份（无 courseOverlapApprovals）→ restore 正常、不伪造 Approval", async () => {
    seedState({ studyBlocks: [
      { id: "sb1", title: "旧块", date: mondayStr(0), startTime: "10:30", endTime: "11:30", assignmentId: "a2", courseId: "c1", source: "kiro" },
    ]});
    const { store } = await fresh();
    const snapshot = store.getState();
    const backupData = {
      userProfile: snapshot.userProfile,
      semester: snapshot.semester,
      courses: snapshot.courses,
      schedules: snapshot.schedules,
      assignments: snapshot.assignments,
      calendarMarks: snapshot.calendarMarks,
      groupProjects: snapshot.groupProjects,
      studyBlocks: snapshot.studyBlocks,
    };
    const validated = validateBackup({ version: 1, data: backupData } as never);
    expect(validated.ok).toBe(true);
    useAppStore.setState({ ...backupData } as never);
    const restored = useAppStore.getState().studyBlocks[0];
    expect(restored.courseOverlapApprovals).toBeUndefined();
  });
});
