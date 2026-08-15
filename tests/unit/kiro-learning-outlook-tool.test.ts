import { describe, it, expect, beforeEach } from "vitest";
import { executeGetLearningOutlook } from "@/lib/ai/tools/read/outlook";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { getLearningOutlookSchema } from "@/lib/ai/tools/read/schemas";
import { useAppStore } from "@/store/useAppStore";
import { clearLearningHistoryStorage, setLearningHistoryCoverage } from "@/lib/history/store";
import { buildStudyOutlook } from "@/lib/outlook/studyOutlook";
import { Assignment } from "@/types";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };

function mk(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: `任务${id}`, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [], courseName: undefined,
    ...patch,
  } as Assignment;
}

const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: Date.now() - 60 * 86400000,
    initializedAt: Date.now() - 60 * 86400000,
    focusBackfillCompleted: true,
    backfilledFocusSessions: 0,
  });
  useAppStore.setState({
    semester: SEMESTER as never,
    currentSemesterWeek: 1,
    assignments: [
      mk("a1", { ddl: iso(new Date(Date.now() + 3 * 86400000)), estimatedMinutes: 60 }),
      mk("a2", { ddl: iso(new Date(Date.now() - 86400000)), estimatedMinutes: 60 }), // overdue
      mk("a3", { ddl: iso(new Date(Date.now() + 10 * 86400000)), estimatedMinutes: 60 }), // 7 天外 / 14 天内
    ],
    studyBlocks: [],
    schedules: [],
    calendarMarks: [],
    courses: [{ id: "c1", name: "数据结构", code: "C1", credit: 3, teacher: "T", classroom: "R", description: "", bgHex: "#fff", borderHex: "#ddd", materials: [] }] as never[],
  });
});

describe("get_learning_outlook（canonical tool）", () => {
  it("schema：7/14 合法；缺省 → 7；非法（180 / 任意值）→ INVALID_INPUT", () => {
    expect(getLearningOutlookSchema.safeParse({}).success).toBe(true);
    expect(getLearningOutlookSchema.safeParse({}).data?.horizonDays).toBe(7);
    expect(getLearningOutlookSchema.safeParse({ horizonDays: 7 }).success).toBe(true);
    expect(getLearningOutlookSchema.safeParse({ horizonDays: 14 }).success).toBe(true);
    expect(getLearningOutlookSchema.safeParse({ horizonDays: 180 }).success).toBe(false);
    expect(getLearningOutlookSchema.safeParse({ horizonDays: 8 }).success).toBe(false);
    expect(getLearningOutlookSchema.safeParse({ from: "2026-08-01" }).success).toBe(false);
  });

  it("Canonical Invariant：Tool Output 与 buildStudyOutlook 核心字段一致", async () => {
    const state = useAppStore.getState();
    const b = await executeGetLearningOutlook({ horizonDays: 7 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const out = b.data as Record<string, any>;

    expect(out.horizonDays).toBe(7);
    // 与直接 build 一致：2 个截止任务（a1 + overdue a2），a3 在 horizon 外
    expect(out.summary.counts.totalDue).toBe(2);
    expect(out.summary.counts.overdue).toBe(1);
    expect(out.summary.counts.noDeadline).toBe(0);
    // 排序：overdue 第一
    expect(out.tasks[0].assignmentId).toBe("a2");
    expect(out.tasks[0].health).toBe("overdue");
    expect(out.tasks[1].assignmentId).toBe("a1");
    // 不外泄：无 raw events / 无完整 StudyBlock 列表
    expect(out.tasks[0].reasons).toBeDefined();
    expect(out.estimateCalibration).toBeDefined();
    expect(out.estimateCalibration.status).toBe("insufficient-data");

    // 直接 build 对照
    const direct = buildStudyOutlook({
      assignments: state.assignments,
      studyBlocks: state.studyBlocks,
      schedules: state.schedules,
      calendarMarks: state.calendarMarks,
      courses: state.courses,
      semester: state.semester,
      currentSemesterWeek: state.currentSemesterWeek,
      horizonDays: 7,
      now: new Date(),
      calibration: {
        status: "insufficient-data",
        sampleCount: 0,
        excludedOutliers: 0,
        medianRatio: null,
        interpretation: null,
        byCourse: [],
        samples: [],
      },
    });
    expect(out.summary.counts.totalDue).toBe(direct.summary.counts.totalDue);
    expect(out.summary.counts.overdue).toBe(direct.summary.counts.overdue);
    expect(out.tasks.map((t: { assignmentId: string }) => t.assignmentId)).toEqual(
      direct.tasks.map((t) => t.assignmentId)
    );
  });

  it("14 天 horizon：horizon 外任务进入", async () => {
    const b = await executeGetLearningOutlook({ horizonDays: 14 });
    expect(b.ok).toBe(true);
    if (b.ok) {
      const out = b.data as { summary: { counts: { totalDue: number } } };
      expect(out.summary.counts.totalDue).toBe(3); // a3 现在在 14 天内
    }
  });

  it("非法 horizon → INVALID_INPUT；executor 同步路径拒绝（不破坏 sync read tools）", async () => {
    const r = await executeGetLearningOutlook({ horizonDays: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");

    const state = {
      semester: SEMESTER,
      currentSemesterWeek: 1,
      activeTab: "overview",
      selectedCourseId: null,
      selectedAssignmentId: null,
      highlightedAssignmentId: null,
      userProfile: { name: "", college: "", grade: "", completedCredits: 0, totalCredits: 0 },
      courses: [],
      schedules: [],
      assignments: [],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [],
      reminders: [],
      focusSessions: [],
    };
    const q = executeKiroReadTool("get_learning_outlook", {}, state as never);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.message).toContain("需要异步执行");
    const ctx = executeKiroReadTool("get_current_context", {}, state as never);
    expect(ctx.ok).toBe(true);
  });

  it("Part 4：输出含共享容量 facts / capacityForecast / firstCapacityShortfall；不暴露 projectedBlocks", async () => {
    // 制造容量竞争：今天全天 busy + 明天只剩 180min；A=120 B=120
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const dayStr = (offset: number) => {
      const d = new Date(Date.now() + offset * 86400000);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    };
    useAppStore.setState({
      semester: SEMESTER as never,
      currentSemesterWeek: 1,
      assignments: [
        mk("a1", { ddl: iso(new Date(Date.now() + 1 * 86400000)), estimatedMinutes: 120 }),
        mk("a2", { ddl: iso(new Date(Date.now() + 1 * 86400000)), estimatedMinutes: 120 }),
      ],
      studyBlocks: [],
      schedules: [],
      calendarMarks: [
        { id: "cm0", date: dayStr(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
        { id: "cm1", date: dayStr(1), type: "exam", title: "考试", startTime: "08:00", endTime: "18:00" },
      ],
      courses: [],
    });
    const b = await executeGetLearningOutlook({ horizonDays: 7 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const out = b.data as any;

    // workload：需求 240 vs 可分配 180 vs 缺口 60
    expect(out.summary.workload.remainingKnownMinutes).toBe(240);
    expect(out.summary.workload.preferredAllocatedMinutes).toBe(180);
    expect(out.summary.workload.preferredShortfallMinutes).toBe(60);
    expect(typeof out.summary.workload.unusedFreeMinutes).toBe("number");

    // 每个任务带 capacity facts
    for (const t of out.tasks as { capacityAllocatedMinutes: number | null; capacityShortfallMinutes: number | null; capacityComplete: boolean | null }[]) {
      expect(typeof t.capacityAllocatedMinutes).toBe("number");
      expect(typeof t.capacityShortfallMinutes).toBe("number");
      expect(typeof t.capacityComplete).toBe("boolean");
    }
    expect((out.tasks as { capacityComplete: boolean | null }[]).filter((t) => t.capacityComplete === false).length).toBe(1);

    // capacityForecast + firstCapacityShortfall
    expect(Array.isArray(out.capacityForecast)).toBe(true);
    expect(out.capacityForecast.length).toBe(1);
    expect(out.capacityForecast[0].cumulativeShortfallMinutes).toBe(60);
    expect(out.firstCapacityShortfall).not.toBeNull();
    expect(out.firstCapacityShortfall.shortfallMinutes).toBe(60);

    // bounded：不暴露 projected slots（Proposal 阶段才需要）
    const taskKeys = Object.keys(out.tasks[0]);
    expect(taskKeys).not.toContain("projectedBlocks");
    expect(taskKeys).not.toContain("proposedBlocks");
  });
});
