import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PLAN_STEPS,
  normalizeAgentPlan,
  summarizeAgentPlan,
} from "@/lib/ai/agent/plan";

describe("normalizeAgentPlan", () => {
  it("归一化标题/步骤/状态，并补全稳定 id", () => {
    const plan = normalizeAgentPlan({
      title: "  准备  计量经济学作业  ",
      steps: [
        { title: "阅读任务要求", status: "in_progress" },
        { title: "整理数据", status: "pending" },
        { title: "写报告", status: "completed" },
      ],
    });
    expect(plan).toEqual({
      title: "准备 计量经济学作业",
      steps: [
        { id: "step-1", title: "阅读任务要求", status: "in_progress" },
        { id: "step-2", title: "整理数据", status: "pending" },
        { id: "step-3", title: "写报告", status: "completed" },
      ],
    });
  });

  it("兼容常见状态别名与字符串步骤", () => {
    const plan = normalizeAgentPlan({
      steps: ["读资料", { title: "写提纲", status: "doing" }, { title: "完成", status: "done" }],
    });
    expect(plan?.steps.map((s) => s.status)).toEqual(["pending", "in_progress", "completed"]);
  });

  it("去重 id、丢弃空标题、限制最大步骤数", () => {
    const steps = Array.from({ length: MAX_AGENT_PLAN_STEPS + 5 }, (_, i) => ({
      id: i < 2 ? "dup" : `s-${i}`,
      title: i === 3 ? "   " : `步骤 ${i}`,
    }));
    const plan = normalizeAgentPlan({ steps });
    expect(plan?.steps).toHaveLength(MAX_AGENT_PLAN_STEPS);
    expect(new Set(plan?.steps.map((s) => s.id)).size).toBe(plan?.steps.length);
    expect(plan?.steps.some((s) => s.title === "")).toBe(false);
  });

  it("无有效步骤 / 非对象 → null", () => {
    expect(normalizeAgentPlan(null)).toBeNull();
    expect(normalizeAgentPlan({ steps: [] })).toBeNull();
    expect(normalizeAgentPlan({ steps: [{ title: "   " }] })).toBeNull();
  });
});

describe("summarizeAgentPlan", () => {
  it("统计完成数/当前步骤/进度", () => {
    const plan = normalizeAgentPlan({
      steps: [
        { title: "A", status: "completed" },
        { title: "B", status: "in_progress" },
        { title: "C", status: "pending" },
        { title: "D", status: "pending" },
      ],
    })!;
    const summary = summarizeAgentPlan(plan);
    expect(summary.total).toBe(4);
    expect(summary.completed).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.nextStep?.title).toBe("B");
    expect(summary.progressPercent).toBe(25);
  });

  it("全部完成后 nextStep=null，进度 100", () => {
    const plan = normalizeAgentPlan({
      steps: [
        { title: "A", status: "completed" },
        { title: "B", status: "completed" },
      ],
    })!;
    const summary = summarizeAgentPlan(plan);
    expect(summary.nextStep).toBeNull();
    expect(summary.progressPercent).toBe(100);
  });
});
