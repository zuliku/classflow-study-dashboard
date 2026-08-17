import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Kiro Task 4B：Study Plan Atomic Apply Domain（preflightStudyPlan / applyStudyPlan / createStudyPlanProposalKey）。
 * 验证 All-or-None：任何 stale / conflict / 非法输入 → 0 mutation。
 */

const KEY = "classflow-storage-v2";

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function iso(offset: number, hour = 23, minute = 59): string {
  return `${dayStr(offset)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

/** 周一/周日统一化为 Monday（dayOfWeek=1）的日期；offset 为距今天的天数 */
function mondayStr(offset: number): string {
  const d = new Date();
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() + offset - (dow - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seedState(overrides: { schedules?: unknown[]; studyBlocks?: unknown[]; calendarMarks?: unknown[] } = {}) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: mondayStr(0), totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "王老师", classroom: "教101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules:
      overrides.schedules ??
      [{ id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" }],
    assignments: [
      // DDL：3 天后 18:00（DDL 当天 18:00 之后的时间不可用）
      { id: "a1", courseId: "c1", title: "数据库报告", description: "", ddl: iso(3, 18, 0), priority: "medium", status: "todo", progress: 0, tags: [], estimatedMinutes: 90 },
      { id: "a2", courseId: "c1", title: "计量经济学作业", description: "", priority: "high", status: "doing", progress: 10, tags: [], estimatedMinutes: 120 },
    ],
    calendarMarks: overrides.calendarMarks ?? [],
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
  return { store: storeMod.useAppStore, apply: applyMod };
}

const block = (assignmentId: string, date: string, startTime: string, endTime: string) => ({
  assignmentId,
  title: "任务",
  courseId: "c1",
  date,
  startTime,
  endTime,
});

beforeEach(() => {
  localStorage.clear();
});

describe("applyStudyPlan：正常 Apply", () => {
  it("批量创建真实 StudyBlock：source=kiro，保留 title/date/time/assignmentId/courseId", async () => {
    seedState();
    const { store, apply } = await fresh();
    const result = apply.applyStudyPlan(
      {
        blocks: [
          block("a1", dayStr(1), "19:00", "20:00"),
          block("a1", dayStr(2), "10:00", "11:00"),
        ],
      },
      store.getState()
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.state !== "created") return;
    expect(result.created.length).toBe(2);
    expect(store.getState().studyBlocks.length).toBe(2);
    for (const b of result.created) {
      expect(b.source).toBe("kiro");
      expect(b.assignmentId).toBe("a1");
      expect(b.courseId).toBe("c1");
      expect(b.id).toMatch(/^sb_/);
    }
    // Proposal Fingerprint：稳定排序，与数组顺序无关
    const key = apply.createStudyPlanProposalKey([
      { assignmentId: "a1", date: dayStr(1), startTime: "19:00", endTime: "20:00" },
      { assignmentId: "a1", date: dayStr(2), startTime: "10:00", endTime: "11:00" },
    ]);
    const reversed = apply.createStudyPlanProposalKey([
      { assignmentId: "a1", date: dayStr(2), startTime: "10:00", endTime: "11:00" },
      { assignmentId: "a1", date: dayStr(1), startTime: "19:00", endTime: "20:00" },
    ]);
    expect(key).toBe(reversed);
  });
});

describe("applyStudyPlan：输入校验", () => {
  it("规划窗口外（07:00–08:00）→ INVALID_INPUT，0 mutation", async () => {
    seedState();
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "07:00", "08:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("INVALID_INPUT");
    expect(store.getState().studyBlocks.length).toBe(0);
  });

  it("end <= start → INVALID_INPUT", async () => {
    seedState();
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "20:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("INVALID_INPUT");
  });

  it("非法日期 / 时间格式 → INVALID_INPUT", async () => {
    seedState();
    const { store, apply } = await fresh();
    const r1 = apply.applyStudyPlan({ blocks: [block("a1", "2026/01/01", "19:00", "20:00")] }, store.getState());
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.code).toBe("INVALID_INPUT");
  });
});

describe("applyStudyPlan：任务 stale", () => {
  it("任务已删除 → STALE_PROPOSAL，0 mutation", async () => {
    seedState();
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a_missing", dayStr(1), "19:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("STALE_PROPOSAL");
    expect(store.getState().studyBlocks.length).toBe(0);
  });

  it("任务已 completed → STALE_PROPOSAL，0 mutation", async () => {
    seedState();
    const { store, apply } = await fresh();
    store.getState().updateAssignmentStatus("a1", "completed");
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "19:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("STALE_PROPOSAL");
    expect(store.getState().studyBlocks.length).toBe(0);
  });

  it("DDL 提前：Block 落在 Deadline 之后 → STALE_PROPOSAL", async () => {
    seedState();
    const { store, apply } = await fresh();
    // a1 DDL = 3 天后 18:00；安排 3 天后 19:00–20:00 → 超过 Deadline
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(3), "19:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("STALE_PROPOSAL");
    expect(r.details?.reason).toBe("block_after_deadline");
    expect(store.getState().studyBlocks.length).toBe(0);
  });
});

describe("applyStudyPlan：冲突（Task 5 soft course overlap）", () => {
  it("课程重叠 → SOFT：默认 needsApproval（0 mutation），allowCourseOverlap 后整批写入", async () => {
    seedState();
    const { store, apply } = await fresh();
    // 本周周一 09:00–10:00 与 08:00–09:40 课程重叠（a2 无 DDL，避免 Deadline 检查先触发）
    const input = { blocks: [block("a2", mondayStr(0), "09:00", "10:00")] };
    const r = apply.applyStudyPlan(input, store.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(r.courseOverlaps).toHaveLength(1);
    expect(r.courseOverlaps[0].courseName).toBeTruthy();
    expect(store.getState().studyBlocks.length).toBe(0); // 未确认 → 0 mutation

    const approved = apply.applyStudyPlan(input, store.getState(), { allowCourseOverlap: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.state !== "created") return;
    expect(store.getState().studyBlocks.length).toBe(1);
  });

  it("课程周次按 Block 自身日期计算：非生效周不冲突（不用 UI 当前周）", async () => {
    seedState({
      // 只在第 9 周生效的课程（9-16周；本测试 semester startDate = 本周一 → 下周第 2 周）
      schedules: [{ id: "s2", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "9-16周" }],
    });
    const { store, apply } = await fresh();
    const week2Monday = mondayStr(7); // 第 2 周周一：课程不生效
    const week9Monday = mondayStr(7 * 8); // 第 9 周周一：课程生效
    const ok = apply.applyStudyPlan({ blocks: [block("a2", week2Monday, "09:00", "10:00")] }, store.getState());
    expect(ok.ok).toBe(true);
    if (!ok.ok || ok.state !== "created") return;
    expect(store.getState().studyBlocks.length).toBe(1);
    store.getState().deleteStudyBlocksBatch(ok.created.map((b) => b.id));

    const overlap = apply.applyStudyPlan({ blocks: [block("a2", week9Monday, "09:00", "10:00")] }, store.getState());
    expect(overlap.ok).toBe(true);
    if (!overlap.ok || overlap.state !== "needs-approval") return;
    expect(overlap.courseOverlaps).toHaveLength(1);
    expect(store.getState().studyBlocks.length).toBe(0);
  });

  it("固定时段考试冲突 → CONFLICT", async () => {
    seedState({ calendarMarks: [{ id: "cm1", date: dayStr(1), type: "exam", title: "小测", startTime: "19:00", endTime: "20:30" }] });
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "19:30", "20:30")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("fixed_event_conflict");
  });

  it("全天考试 → CONFLICT（整天 blocked）", async () => {
    seedState({ calendarMarks: [{ id: "cm1", date: dayStr(1), type: "exam", title: "全天考试" }] });
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "19:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("all_day_event_conflict");
  });

  it("DDL mark 不是 busy：Deadline 当天 Deadline 前的 Block 通过", async () => {
    seedState({ calendarMarks: [{ id: "cm1", date: dayStr(3), type: "ddl", title: "数据库报告", sourceId: "a1" }] });
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(3), "10:00", "11:00")] }, store.getState());
    expect(r.ok).toBe(true);
  });

  it("与现有 StudyBlock 重叠 → CONFLICT（Proposal 后手动新增）", async () => {
    seedState({
      studyBlocks: [{ id: "sb_manual", title: "复习", date: dayStr(1), startTime: "19:00", endTime: "20:30", assignmentId: "a2", courseId: "c1", source: "manual" }],
    });
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "19:30", "21:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("studyblock_conflict");
    expect(store.getState().studyBlocks.length).toBe(1); // 未新增
  });

  it("与现有 StudyBlock 完全相同 → duplicate（STALE_PROPOSAL）", async () => {
    seedState({
      studyBlocks: [{ id: "sb_manual", title: "数据库报告", date: dayStr(1), startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "manual" }],
    });
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan({ blocks: [block("a1", dayStr(1), "19:00", "20:00")] }, store.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("STALE_PROPOSAL");
    expect(r.details?.reason).toBe("duplicate_block");
  });

  it("Proposed Blocks 互相重叠 → CONFLICT（projected set）", async () => {
    seedState();
    const { store, apply } = await fresh();
    const r = apply.applyStudyPlan(
      {
        blocks: [
          block("a1", dayStr(1), "19:00", "20:00"),
          block("a2", dayStr(1), "19:30", "21:00"),
        ],
      },
      store.getState()
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("proposal_self_conflict");
    expect(store.getState().studyBlocks.length).toBe(0);
  });
});

describe("applyStudyPlan：All-or-None", () => {
  it("3 个块中第 2 个与课程重叠 → 未确认时整批 0 创建；确认后整批 3 个写入", async () => {
    seedState();
    const { store, apply } = await fresh();
    const input = {
      blocks: [
        block("a1", dayStr(1), "10:00", "11:00"),
        block("a2", mondayStr(7), "09:00", "10:00"), // 课程重叠（soft）
        block("a1", dayStr(2), "10:00", "11:00"),
      ],
    };
    const r = apply.applyStudyPlan(input, store.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(r.courseOverlaps).toHaveLength(1);
    expect(store.getState().studyBlocks.length).toBe(0); // 未确认 → 整批 0 创建

    const approved = apply.applyStudyPlan(input, store.getState(), { allowCourseOverlap: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.state !== "created") return;
    expect(approved.created.length).toBe(3); // 确认后整批写入（all-or-nothing）
  });

  it("Double Apply：第二次 → duplicate stale，只保留一份", async () => {
    seedState();
    const { store, apply } = await fresh();
    const input = { blocks: [block("a1", dayStr(1), "19:00", "20:00")] };
    const first = apply.applyStudyPlan(input, store.getState());
    expect(first.ok).toBe(true);
    const second = apply.applyStudyPlan(input, store.getState());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("STALE_PROPOSAL");
    expect(store.getState().studyBlocks.length).toBe(1);
  });
});

describe("deleteStudyBlocksBatch：Undo 只删除本次 Apply 的 ID", () => {
  it("原有 2 个 manual + Kiro 新增 3 个 → 撤销只删 3 个", async () => {
    seedState({
      studyBlocks: [
        { id: "sb_m1", title: "手动1", date: dayStr(1), startTime: "08:00", endTime: "09:00", source: "manual" },
        { id: "sb_m2", title: "手动2", date: dayStr(1), startTime: "10:00", endTime: "11:00", source: "manual" },
      ],
    });
    const { store, apply } = await fresh();
    const result = apply.applyStudyPlan(
      {
        blocks: [
          block("a1", dayStr(2), "19:00", "20:00"),
          block("a1", dayStr(3), "10:00", "11:00"),
          block("a2", dayStr(4), "19:00", "20:00"),
        ],
      },
      store.getState()
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.state !== "created") return;
    expect(store.getState().studyBlocks.length).toBe(5);

    const removed = store.getState().deleteStudyBlocksBatch(result.created.map((b) => b.id));
    expect(removed.length).toBe(3);
    const remaining = store.getState().studyBlocks;
    expect(remaining.length).toBe(2);
    expect(remaining.some((b) => b.id === "sb_m1")).toBe(true);
    expect(remaining.some((b) => b.id === "sb_m2")).toBe(true);
    expect(remaining.some((b) => b.source === "kiro")).toBe(false);
  });
});
