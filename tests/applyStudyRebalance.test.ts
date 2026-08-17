import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { clearLearningHistoryStorage } from "@/lib/history/store";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery } from "@/lib/history/query";
import {
  applyStudyRebalance,
  undoStudyRebalance,
  preflightStudyRebalance,
  RebalanceMoveInput,
} from "@/lib/planning/applyStudyRebalance";
import { projectStudyPlans } from "@/lib/analytics/studyPlanProjection";

const DAY = 86400000;
const dayStr = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function seed(a1: { ddl: string; status?: string }, blockPatch: { date: string; startTime: string; endTime: string; source?: string; assignmentId?: string } = { date: dayStr(3), startTime: "19:00", endTime: "20:00" }) {
  useAppStore.setState({
    semester: { id: "s", name: "S", startDate: dayStr(-14), totalWeeks: 16 } as never,
    assignments: [
      {
        id: "a1", courseId: "c1", title: "任务A", description: "", priority: "medium",
        status: a1.status ?? "todo", progress: 0, tags: [], ddl: a1.ddl, estimatedMinutes: 120,
      } as never,
    ],
    studyBlocks: [
      {
        id: "sb1", title: "计划A", date: blockPatch.date, startTime: blockPatch.startTime,
        endTime: blockPatch.endTime, assignmentId: blockPatch.assignmentId ?? "a1", courseId: "c1",
        source: blockPatch.source ?? "kiro",
      } as never,
    ],
    schedules: [],
    calendarMarks: [],
    reminders: [],
  });
}

function move(): RebalanceMoveInput {
  return {
    blockId: "sb1",
    from: { date: dayStr(3), startTime: "19:00", endTime: "20:00" },
    to: { date: dayStr(4), startTime: "19:00", endTime: "20:00" },
  };
}

async function historyEvents() {
  await flushLearningHistoryQueue();
  return collectLearningHistoryEvents(resolveLearningHistoryQuery({}));
}

beforeEach(async () => {
  await flushLearningHistoryQueue(); // 先 drain 上一测试遗留队列，再清库（避免跨测试泄漏）
  await clearLearningHistoryStorage();
});

describe("updateStudyBlocksBatch（store）", () => {
  it("§81 2 blocks 原子更新：单次 state 结果 + 2 个 updated events + 共享 occurredAt + sequence 稳定", async () => {
    useAppStore.setState({
      semester: { id: "s", name: "S", startDate: dayStr(-14), totalWeeks: 16 } as never,
      assignments: [],
      studyBlocks: [
        { id: "sb1", title: "A", date: dayStr(3), startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "kiro" } as never,
        { id: "sb2", title: "B", date: dayStr(3), startTime: "20:00", endTime: "21:00", assignmentId: "a1", courseId: "c1", source: "kiro" } as never,
      ],
      reminders: [],
    });
    const result = useAppStore.getState().updateStudyBlocksBatch(
      [
        { id: "sb1", patch: { date: dayStr(4), startTime: "18:00", endTime: "19:00" } },
        { id: "sb2", patch: { date: dayStr(5), startTime: "10:00", endTime: "11:00" } },
      ],
      { source: "kiro" }
    );
    expect(result).not.toBeNull();
    expect(result!.before).toHaveLength(2);
    expect(result!.after).toHaveLength(2);
    const state = useAppStore.getState();
    expect(state.studyBlocks.find((b) => b.id === "sb1")!.date).toBe(dayStr(4));
    expect(state.studyBlocks.find((b) => b.id === "sb2")!.date).toBe(dayStr(5));
    // ID / source 不变
    expect(state.studyBlocks.map((b) => b.id).sort()).toEqual(["sb1", "sb2"]);

    const events = (await historyEvents()).filter((e) => e.type === "study_block.updated");
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.occurredAt)).size).toBe(1);
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    expect(sorted[0].sequence).toBeLessThan(sorted[1].sequence);
  });

  it("all-or-none：任何 ID 不存在 → null + 0 mutation", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    const before = useAppStore.getState().studyBlocks;
    const result = useAppStore.getState().updateStudyBlocksBatch(
      [
        { id: "sb1", patch: { date: dayStr(4), startTime: "19:00", endTime: "20:00" } },
        { id: "missing", patch: { date: dayStr(4), startTime: "19:00", endTime: "20:00" } },
      ]
    );
    expect(result).toBeNull();
    expect(useAppStore.getState().studyBlocks).toEqual(before);
  });

  it("重复 ID → null + 0 mutation", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    const result = useAppStore.getState().updateStudyBlocksBatch([
      { id: "sb1", patch: { date: dayStr(4), startTime: "19:00", endTime: "20:00" } },
      { id: "sb1", patch: { date: dayStr(5), startTime: "19:00", endTime: "20:00" } },
    ]);
    expect(result).toBeNull();
  });

  it("no-op update（位置未变）→ 0 events", async () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.getState().updateStudyBlocksBatch([
      { id: "sb1", patch: { date: dayStr(3), startTime: "19:00", endTime: "20:00" } },
    ]);
    const events = await historyEvents();
    expect(events.filter((e) => e.type === "study_block.updated")).toHaveLength(0);
  });

  it("§66 relative Reminder 随 move 同步到新锚点；Undo 恢复旧锚点", async () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.setState({
      reminders: [
        {
          id: "r1", title: "提醒", targetType: "studyBlock", targetId: "sb1",
          timingMode: "relative", triggerAt: `${dayStr(3)}T18:30:00`, offsetMinutes: -30,
          status: "scheduled", createdAt: Date.now(),
        } as never,
      ],
    });
    // Apply move（Thu 19:00 → Fri 19:00）→ reminder 锚点跟随
    const applied = applyStudyRebalance([move()], useAppStore.getState());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    let reminder = useAppStore.getState().reminders.find((r) => r.id === "r1")!;
    expect(reminder.triggerAt).toBe(`${dayStr(4)}T18:30:00`);

    // Undo → 恢复旧锚点
    const undone = undoStudyRebalance([move()], useAppStore.getState());
    expect(undone.ok).toBe(true);
    reminder = useAppStore.getState().reminders.find((r) => r.id === "r1")!;
    expect(reminder.triggerAt).toBe(`${dayStr(3)}T18:30:00`);
  });
});

describe("applyStudyRebalance / undoStudyRebalance", () => {
  it("§79 apply 成功 → ID 保持、位置变化、History source=kiro；undo 成功 → source=manual，两条 updated 都在", async () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    const applied = applyStudyRebalance([move()], useAppStore.getState());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const after = useAppStore.getState().studyBlocks[0];
    expect(after.id).toBe("sb1");
    expect(after.date).toBe(dayStr(4));

    let events = (await historyEvents()).filter((e) => e.type === "study_block.updated");
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("kiro");

    const undone = undoStudyRebalance([move()], useAppStore.getState());
    expect(undone.ok).toBe(true);
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(3));

    events = (await historyEvents()).filter((e) => e.type === "study_block.updated");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.source).sort()).toEqual(["kiro", "manual"]);
  });

  it("§78 stale fingerprint：Apply 前用户手动改到 Wed → STALE_PROPOSAL，Wed 保持", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.getState().updateStudyBlock("sb1", { date: dayStr(3), startTime: "10:00", endTime: "11:00" });
    const applied = applyStudyRebalance([move()], useAppStore.getState());
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.code).toBe("STALE_PROPOSAL");
    expect(useAppStore.getState().studyBlocks[0].startTime).toBe("10:00"); // 不被覆盖
  });

  it("§77 apply atomic：一个 target 冲突 → 全部 0 updates", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    // 第二个 move 指向与受保护 block 冲突的时间
    const moves: RebalanceMoveInput[] = [
      move(),
      {
        blockId: "sb1",
        from: { date: dayStr(3), startTime: "19:00", endTime: "20:00" },
        to: { date: dayStr(3), startTime: "08:00", endTime: "09:00" }, // 与 sb1 自身旧位置不同 → 但 sb1 被排除…
      },
    ];
    // 构造真正的冲突：另一 move 的目标与受保护 manual block 重叠
    useAppStore.setState({
      studyBlocks: [
        useAppStore.getState().studyBlocks[0],
        { id: "manual1", title: "手动", date: dayStr(4), startTime: "18:30", endTime: "19:30", assignmentId: "a1", courseId: "c1", source: "manual" } as never,
      ],
    });
    const applied = applyStudyRebalance([move()], useAppStore.getState());
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.code).toBe("CONFLICT");
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(3)); // 0 mutation
  });

  it("§32 非 kiro block → preflight 拒绝", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` }, { date: dayStr(3), startTime: "19:00", endTime: "20:00", source: "manual" });
    const p = preflightStudyRebalance([move()], useAppStore.getState());
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.code).toBe("STALE_PROPOSAL");
  });

  it("§35 moves 彼此 target 冲突 → preflight 拒绝（不能部分应用）", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.setState({
      studyBlocks: [
        { id: "sb1", title: "A", date: dayStr(3), startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "kiro" } as never,
        { id: "sb2", title: "B", date: dayStr(3), startTime: "20:00", endTime: "21:00", assignmentId: "a1", courseId: "c1", source: "kiro" } as never,
      ],
    });
    const moves: RebalanceMoveInput[] = [
      { blockId: "sb1", from: { date: dayStr(3), startTime: "19:00", endTime: "20:00" }, to: { date: dayStr(4), startTime: "19:00", endTime: "20:00" } },
      { blockId: "sb2", from: { date: dayStr(3), startTime: "20:00", endTime: "21:00" }, to: { date: dayStr(4), startTime: "19:30", endTime: "20:30" } },
    ];
    const p = preflightStudyRebalance(moves, useAppStore.getState());
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.code).toBe("CONFLICT");
  });

  it("§80 undo stale：Apply 后用户再改 → Undo 拒绝且保持新位置", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    const applied = applyStudyRebalance([move()], useAppStore.getState());
    expect(applied.ok).toBe(true);
    // 用户手动改到 Wed
    useAppStore.getState().updateStudyBlock("sb1", { date: dayStr(3), startTime: "10:00", endTime: "11:00" });
    const undone = undoStudyRebalance([move()], useAppStore.getState());
    expect(undone.ok).toBe(false);
    if (undone.ok) return;
    expect(undone.code).toBe("STALE_PROPOSAL");
    expect(useAppStore.getState().studyBlocks[0].startTime).toBe("10:00"); // Wed 保持
  });
});

describe("applyStudyRebalance：Task 6 Course soft-overlap", () => {
  function seedWithCourseOverTarget() {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    const dow = new Date(`${dayStr(4)}T00:00:00`).getDay() === 0 ? 7 : new Date(`${dayStr(4)}T00:00:00`).getDay();
    useAppStore.setState({
      schedules: [
        { id: "sch1", courseId: "c2", dayOfWeek: dow, startTime: "08:00", endTime: "21:00", location: "", weeks: "1-16周" } as never,
      ],
    });
  }

  it("A：target 与 Course overlap → preflight ok + courseOverlaps=1（soft，不失败）", () => {
    seedWithCourseOverTarget();
    const p = preflightStudyRebalance([move()], useAppStore.getState());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.courseOverlaps).toHaveLength(1);
    expect(p.courseOverlaps[0]).toMatchObject({
      blockId: "sb1",
      date: dayStr(4),
      startTime: "19:00",
      endTime: "20:00",
      courseName: "未知课程",
    });
  });

  it("B：apply 未确认 → state=needs-approval + 0 mutation", () => {
    seedWithCourseOverTarget();
    const r = applyStudyRebalance([move()], useAppStore.getState());
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "needs-approval") return;
    expect(r.courseOverlaps).toHaveLength(1);
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(3)); // 0 mutation
  });

  it("C：allowCourseOverlap → 整批 atomic apply", () => {
    seedWithCourseOverTarget();
    const r = applyStudyRebalance([move()], useAppStore.getState(), { allowCourseOverlap: true });
    expect(r.ok).toBe(true);
    if (!r.ok || r.state !== "applied") return;
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(4));
  });

  it("D：target 与受保护 StudyBlock 重叠 → 仍 hard fail（StudyBlock 是硬约束）", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.setState({
      studyBlocks: [
        useAppStore.getState().studyBlocks[0],
        { id: "other", title: "已有计划", date: dayStr(4), startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "manual" } as never,
      ],
    });
    const r = applyStudyRebalance([move()], useAppStore.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("occupancy");
    expect(useAppStore.getState().studyBlocks.find((b) => b.id === "sb1")!.date).toBe(dayStr(3));
  });

  it("E：target 与 Exam overlap → 仍 hard fail", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` });
    useAppStore.setState({
      calendarMarks: [
        { id: "cm1", date: dayStr(4), type: "exam", title: "考试", startTime: "18:00", endTime: "21:00" } as never,
      ],
    });
    const r = applyStudyRebalance([move()], useAppStore.getState());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONFLICT");
    expect(r.details?.reason).toBe("occupancy");
  });

  it("F：Undo 回到 Course-overlap 的 from → 成功，不要求再次确认", () => {
    seedWithCourseOverTarget();
    // 先把 block 移到课程重叠位（用户已确认的合法状态）：Apply with allow → V1.1 写入 approvals
    const applied = applyStudyRebalance([move()], useAppStore.getState(), { allowCourseOverlap: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.state !== "applied") return;
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(4));
    // from 位置本身也覆盖课程（seed 课程全天覆盖 Thu 与 Fri）→ Undo 不应被课程挡住；
    // V1.1：Undo 需携带 Apply 时的 originalApprovals 快照以精确恢复
    const undone = undoStudyRebalance([move()], useAppStore.getState(), {
      originalApprovals: applied.originalApprovals,
      afterApprovals: applied.afterApprovals,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok || undone.state !== "applied") return;
    expect(useAppStore.getState().studyBlocks[0].date).toBe(dayStr(3));
  });
  it("§39 V1.3：20min 短 Block 可被 Rebalance 移动且 duration 保持（<30 不是非法）", () => {
    seed({ ddl: `${dayStr(6)}T23:59:00` }, { date: dayStr(3), startTime: "19:00", endTime: "19:20", source: "kiro" });
    const move20: RebalanceMoveInput = {
      blockId: "sb1",
      from: { date: dayStr(3), startTime: "19:00", endTime: "19:20" },
      to: { date: dayStr(4), startTime: "19:00", endTime: "19:20" },
    };
    const applied = applyStudyRebalance([move20], useAppStore.getState());
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.state !== "applied") return;
    const after = useAppStore.getState().studyBlocks[0];
    expect(after.date).toBe(dayStr(4));
    expect(after.startTime).toBe("19:00");
    expect(after.endTime).toBe("19:20"); // duration 20min 保持
    // undo 恢复
    const undone = undoStudyRebalance([move20], useAppStore.getState(), {
      originalApprovals: applied.originalApprovals,
      afterApprovals: applied.afterApprovals,
    });
    expect(undone.ok).toBe(true);
    expect(useAppStore.getState().studyBlocks[0].endTime).toBe("19:20");
  });
});

describe("Rebalance 与 History projection revision 语义（§82）", () => {
  const ev = (type: string, entityId: string, occurredAt: number, data: Record<string, unknown>) => ({
    type,
    entityId,
    occurredAt,
    sequence: 1,
    data,
  });

  it("scheduledStart 前 move（Tue → Wed）：old revision 不成熟、new revision 成熟（不双计）", () => {
    const t0 = new Date(2026, 7, 10, 9, 0, 0).getTime(); // 周一
    const tue = new Date(2026, 7, 11, 19, 0, 0).getTime();
    const wed = new Date(2026, 7, 12, 19, 0, 0).getTime();
    const result = projectStudyPlans([
      ev("study_block.created", "sb1", t0, { date: "2026-08-11", startTime: "19:00", endTime: "20:00", plannedMinutes: 60 }),
      // Kiro move（update 事件）：周二 → 周三，发生在周二 scheduledStart 之前
      ev("study_block.updated", "sb1", tue - 3600000, {
        date: "2026-08-12", startTime: "19:00", endTime: "20:00",
        dateBefore: "2026-08-11", startTimeBefore: "19:00", endTimeBefore: "20:00", plannedMinutesBefore: 60, plannedMinutesAfter: 60,
      }),
    ]);
    expect(result.maturedPlans).toHaveLength(1);
    expect(result.maturedPlans[0].scheduledStart).toBe(wed);
    expect(result.maturedPlans.some((p) => p.scheduledStart === tue)).toBe(false);
  });

  it("scheduledStart 后 move：old revision 成熟（历史事实）+ new revision 成熟", () => {
    const t0 = new Date(2026, 7, 10, 9, 0, 0).getTime(); // 周一
    const tue = new Date(2026, 7, 11, 19, 0, 0).getTime();
    const wed = new Date(2026, 7, 12, 19, 0, 0).getTime();
    const result = projectStudyPlans([
      ev("study_block.created", "sb1", t0, { date: "2026-08-11", startTime: "19:00", endTime: "20:00", plannedMinutes: 60 }),
      // 周二 21:00 才移动到周三（原计划已成熟）
      ev("study_block.updated", "sb1", tue + 2 * 3600000, {
        date: "2026-08-12", startTime: "19:00", endTime: "20:00",
        dateBefore: "2026-08-11", startTimeBefore: "19:00", endTimeBefore: "20:00", plannedMinutesBefore: 60, plannedMinutesAfter: 60,
      }),
    ]);
    expect(result.maturedPlans).toHaveLength(2);
    expect(result.maturedPlans.map((p) => p.scheduledStart).sort()).toEqual([tue, wed].sort());
  });
});
