import { describe, it, expect } from "vitest";
import { proposeStudyRebalanceSchema } from "@/lib/ai/tools/read/schemas";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { ReadToolState } from "@/lib/ai/tools/read/executor";

const dayStr = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const iso = (offset: number, h = 23, m = 59) => `${dayStr(offset)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;

function state(): ReadToolState {
  return {
    userProfile: { name: "", college: "", grade: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: dayStr(-14), totalWeeks: 16 },
    currentSemesterWeek: 1,
    activeTab: "overview",
    selectedCourseId: null,
    selectedAssignmentId: null,
    highlightedAssignmentId: null,
    courses: [],
    schedules: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignments: [],
    reminders: [],
    focusSessions: [],
  };
}

describe("propose_study_rebalance（schema + executor）", () => {
  it("schema：7/14 合法；缺省 → 7；非法 → INVALID_INPUT", () => {
    expect(proposeStudyRebalanceSchema.safeParse({}).success).toBe(true);
    expect(proposeStudyRebalanceSchema.safeParse({}).data?.horizonDays).toBe(7);
    expect(proposeStudyRebalanceSchema.safeParse({ horizonDays: 14 }).success).toBe(true);
    expect(proposeStudyRebalanceSchema.safeParse({ horizonDays: 8 }).success).toBe(false);
    expect(proposeStudyRebalanceSchema.safeParse({ horizonDays: 30 }).success).toBe(false);
    expect(proposeStudyRebalanceSchema.safeParse({ from: "x" }).success).toBe(false);
  });

  it("executor：after_deadline 场景 → moves 含 from/to/reason；输出 bounded（无 slots / 无内部状态）", () => {
    const st = state();
    st.semester = { id: "s", name: "测试学期", startDate: dayStr(0), totalWeeks: 16 };
    st.assignments = [
      {
        id: "a1", courseId: "c1", title: "概率论作业", description: "", priority: "medium",
        status: "todo", progress: 0, tags: [], ddl: iso(3, 20, 0), estimatedMinutes: 120,
      } as never,
    ];
    // DDL 周四 20:00；Kiro block 周五 19–20 → after_deadline
    st.studyBlocks = [
      {
        id: "sb1", title: "概率论作业", date: dayStr(4), startTime: "19:00", endTime: "20:00",
        assignmentId: "a1", courseId: "c1", source: "kiro",
      } as never,
    ];
    const r = executeKiroReadTool("propose_study_rebalance", {}, st) as {
      ok: true;
      data: { proposal: { moves: unknown[]; summary: Record<string, unknown>; reasons: string[] } };
    };
    expect(r.ok).toBe(true);
    expect(r.data.proposal.moves.length).toBeGreaterThan(0);
    const m = r.data.proposal.moves[0] as { reason: string; from: { date: string }; to: { date: string }; minutes: number };
    expect(m.reason).toBe("after_deadline");
    expect(m.from.date).toBe(dayStr(4));
    expect(m.to.date).toBe(dayStr(3)); // 移到 DDL 当天（end 20:00 <= DDL 20:00）
    expect(m.minutes).toBe(60);
    // bounded：moves 形状无额外字段（如 projectedBlocks / slots）
    expect(Object.keys(m).sort()).toEqual(["assignmentId", "blockId", "courseId", "from", "minutes", "reason", "title", "to"]);
  });

  it("executor：manual block 不移动；horizonDays=14 透传", () => {
    const st = state();
    st.semester = { id: "s", name: "测试学期", startDate: dayStr(0), totalWeeks: 16 };
    st.assignments = [
      {
        id: "a1", courseId: "c1", title: "A", description: "", priority: "medium",
        status: "todo", progress: 0, tags: [], ddl: iso(3, 20, 0), estimatedMinutes: 120,
      } as never,
    ];
    st.studyBlocks = [
      {
        id: "sb1", title: "A", date: dayStr(4), startTime: "19:00", endTime: "20:00",
        assignmentId: "a1", courseId: "c1", source: "manual",
      } as never,
    ];
    const r = executeKiroReadTool("propose_study_rebalance", { horizonDays: 14 }, st) as {
      ok: true;
      data: { proposal: { horizonDays: number; moves: unknown[] } };
    };
    expect(r.data.proposal.horizonDays).toBe(14);
    expect(r.data.proposal.moves).toHaveLength(0);
  });
});
