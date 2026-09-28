import { describe, it, expect } from "vitest";
import {
  approvePlan,
  buildApprovedPlanPromptContext,
  cancelPlan,
  getActivePlan,
  insertProposedPlan,
  markPlanStepDone,
  MAX_STORED_PLANS_PER_CONVERSATION,
  recordPlanDeviation,
  restoreExecutionPlans,
} from "@/lib/ai/computer/plans/lifecycle";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";

const plan = (over: Partial<PersistedExecutionPlan> = {}): PersistedExecutionPlan => ({
  planId: "plan-1",
  conversationId: "conv-1",
  title: "整理",
  status: "proposed",
  steps: [
    { id: "step-1", title: "建目录", toolName: "create_directory", path: "docs", done: false },
    { id: "step-2", title: "写文件", toolName: "create_text_file", path: "docs/a.txt", done: false },
  ],
  proposingToolCallId: "call-1",
  proposingMessageId: "m-1",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  deviationCount: 0,
  ...over,
});

describe("restoreExecutionPlans（严格恢复）", () => {
  it("合法计划还原；非法项丢弃", () => {
    const back = restoreExecutionPlans([plan(), null, { planId: "x" }, { ...plan(), planId: "p2", status: "nope" }]);
    expect(back.map((p) => p.planId)).toEqual(["plan-1"]);
  });
  it("非数组 → 空；步骤非法 → 整计划丢弃", () => {
    expect(restoreExecutionPlans(undefined)).toEqual([]);
    expect(restoreExecutionPlans([{ ...plan(), steps: [] }])).toEqual([]);
    expect(restoreExecutionPlans([{ ...plan(), steps: [{ id: "s", title: "t" }] }])).toEqual([]);
  });
});

describe("insertProposedPlan（单活跃语义）", () => {
  it("新提案 supersede 旧 live，terminal 保留", () => {
    const next = insertProposedPlan(
      [plan({ planId: "old", status: "approved" }), plan({ planId: "done", status: "completed" })],
      plan({ planId: "new", status: "proposed" })
    );
    expect(next.find((p) => p.planId === "old")?.status).toBe("superseded");
    expect(next.find((p) => p.planId === "done")?.status).toBe("completed");
    expect(next.find((p) => p.planId === "new")?.status).toBe("proposed");
  });
  it("超限丢最旧 terminal，live 永不丢", () => {
    const many: PersistedExecutionPlan[] = [];
    for (let i = 0; i < MAX_STORED_PLANS_PER_CONVERSATION + 5; i++) {
      many.push(plan({ planId: `t-${i}`, status: "completed", createdAt: `2026-09-2${i % 9}T00:00:00.000Z` }));
    }
    many.push(plan({ planId: "live", status: "approved" }));
    const next = insertProposedPlan(many, plan({ planId: "new" }));
    expect(next.length).toBe(MAX_STORED_PLANS_PER_CONVERSATION);
    expect(next.some((p) => p.planId === "live")).toBe(true);
    expect(next.some((p) => p.planId === "new")).toBe(true);
  });
});

describe("approvePlan / cancelPlan", () => {
  it("proposed → approved，其余 live → superseded", () => {
    const { plans, ok } = approvePlan(
      [plan({ planId: "a" }), plan({ planId: "b", status: "approved" })],
      "a",
      "2026-09-28T01:00:00.000Z"
    );
    expect(ok).toBe(true);
    expect(plans.find((p) => p.planId === "a")?.status).toBe("approved");
    expect(plans.find((p) => p.planId === "a")?.approvedAt).toBe("2026-09-28T01:00:00.000Z");
    expect(plans.find((p) => p.planId === "b")?.status).toBe("superseded");
  });
  it("非 proposed 批准 → false；terminal 取消 → false", () => {
    expect(approvePlan([plan({ status: "approved" })], "plan-1").ok).toBe(false);
    expect(approvePlan([], "nope").ok).toBe(false);
    expect(cancelPlan([plan({ status: "completed" })], "plan-1").ok).toBe(false);
    const { plans, ok } = cancelPlan([plan()], "plan-1");
    expect(ok).toBe(true);
    expect(plans[0].status).toBe("cancelled");
  });
});

describe("markPlanStepDone / recordPlanDeviation", () => {
  it("逐步完成；全 done → completed", () => {
    const r1 = markPlanStepDone([plan({ status: "approved" })], "plan-1", "step-1");
    expect(r1.ok).toBe(true);
    expect(r1.completed).toBe(false);
    const r2 = markPlanStepDone(r1.plans, "plan-1", "step-2");
    expect(r2.ok).toBe(true);
    expect(r2.completed).toBe(true);
    expect(r2.plans[0].status).toBe("completed");
    expect(r2.plans[0].completedAt).toBeDefined();
  });
  it("proposed 计划不可标记；重复标记 false", () => {
    expect(markPlanStepDone([plan()], "plan-1", "step-1").ok).toBe(false);
    const done = markPlanStepDone([plan({ status: "approved" })], "plan-1", "step-1");
    expect(markPlanStepDone(done.plans, "plan-1", "step-1").ok).toBe(false);
  });
  it("approved → deviated 计数；deviated 继续计数", () => {
    const r1 = recordPlanDeviation([plan({ status: "approved" })], "plan-1");
    expect(r1.ok).toBe(true);
    expect(r1.plans[0].status).toBe("deviated");
    expect(r1.plans[0].deviationCount).toBe(1);
    const r2 = recordPlanDeviation(r1.plans, "plan-1");
    expect(r2.plans[0].deviationCount).toBe(2);
    expect(recordPlanDeviation([plan({ status: "completed" })], "plan-1").ok).toBe(false);
  });
  it("getActivePlan 只取 approved/deviated", () => {
    expect(getActivePlan([plan({ status: "proposed" })])).toBeNull();
    expect(getActivePlan([plan({ status: "deviated" })])?.planId).toBe("plan-1");
  });
});

describe("buildApprovedPlanPromptContext（有界）", () => {
  it("含标题/步骤/scope；超限截断", () => {
    const text = buildApprovedPlanPromptContext(plan({ status: "approved", goal: "整洁" }));
    expect(text).toContain("整理");
    expect(text).toContain("docs/a.txt");
    expect(text).toContain("create_text_file");
    const long = buildApprovedPlanPromptContext(
      plan({ status: "approved", goal: "x".repeat(5000) }),
      100
    );
    expect(long.length).toBe(100);
  });
});

describe("sanitizeConversation — executionPlans 字段", () => {
  const base = {
    id: "c1",
    title: "t",
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "p",
    model: "m",
    messages: [{ id: "u1", role: "user" as const, content: "hi", streaming: false, canRegenerate: true }],
    manualRefs: [],
    entryRefs: [],
  };
  it("非空写入；缺省/空不写字段", () => {
    const rec = sanitizeConversation({ ...base, executionPlans: [plan()] });
    expect(rec.executionPlans).toHaveLength(1);
    expect(rec.executionPlans?.[0].planId).toBe("plan-1");
    expect(sanitizeConversation(base)).not.toHaveProperty("executionPlans");
    expect(sanitizeConversation({ ...base, executionPlans: [] })).not.toHaveProperty("executionPlans");
  });
});
