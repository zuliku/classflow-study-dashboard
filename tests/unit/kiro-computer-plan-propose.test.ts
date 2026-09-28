import { describe, it, expect } from "vitest";
import {
  COMPUTER_PLAN_TOOLS,
  COMPUTER_TOOL_NAMES,
  getComputerToolsForMode,
} from "@/lib/ai/computer/tools/registry";
import { AGENT_MODE_DEFAULTS } from "@/lib/ai/computer/capabilities";
import { riskOfCapability } from "@/lib/ai/computer/approval";
import {
  PROPOSE_EXECUTION_PLAN_TOOL_NAME,
  buildExecutionPlan,
  deriveStepCapability,
  runProposeExecutionPlanTool,
  validatePlanStepAnchors,
} from "@/lib/ai/computer/plans/propose";
import {
  extractPlanCallFacts,
  matchPlanStep,
  normalizePlanPath,
} from "@/lib/ai/computer/plans/match";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";

const CTX = { conversationId: "conv-1", toolCallId: "call-1" };

function approvedPlan(): PersistedExecutionPlan {
  const built = buildExecutionPlan(
    {
      title: "整理",
      steps: [
        { title: "建目录", toolName: "create_directory", path: "docs" },
        { title: "写文件", toolName: "create_text_file", path: "docs/a.txt" },
        { title: "跑测试", toolName: "run_terminal_command", commandPrefix: "npm test" },
      ],
    },
    CTX
  );
  if (!built.ok) throw new Error(built.error);
  return { ...built.plan, status: "approved" };
}

describe("registry — 计划工具暴露", () => {
  it("propose_execution_plan 注册为零 IO 非 mutation 工具", () => {
    expect(PROPOSE_EXECUTION_PLAN_TOOL_NAME).toBe("propose_execution_plan");
    expect(COMPUTER_PLAN_TOOLS.map((t) => t.name)).toEqual(["propose_execution_plan"]);
    expect(COMPUTER_PLAN_TOOLS[0].mutation).toBe(false);
    expect(COMPUTER_PLAN_TOOLS[0].capability).toBe("plan.propose");
    expect(COMPUTER_TOOL_NAMES.has("propose_execution_plan")).toBe(true);
  });
  it("plan 模式有 propose、无 mutation；guided/auto 有 mutation、无 propose", () => {
    const plan = getComputerToolsForMode("plan").map((t) => t.name);
    expect(plan).toContain("propose_execution_plan");
    expect(plan).toContain("read_text");
    expect(plan).not.toContain("delete_file");
    for (const mode of ["guided", "workspace-auto"] as const) {
      const names = getComputerToolsForMode(mode).map((t) => t.name);
      expect(names).toContain("delete_file");
      expect(names).not.toContain("propose_execution_plan");
    }
  });
  it("plan.propose 三模式默认 allow；risk 为 read", () => {
    expect(AGENT_MODE_DEFAULTS.plan["plan.propose"]).toBe("allow");
    expect(AGENT_MODE_DEFAULTS.guided["plan.propose"]).toBe("allow");
    expect(AGENT_MODE_DEFAULTS["workspace-auto"]["plan.propose"]).toBe("allow");
    expect(riskOfCapability("plan.propose")).toBe("read");
  });
});

describe("buildExecutionPlan", () => {
  it("合法输入 → proposed 计划（步骤编号/done=false）", () => {
    const r = buildExecutionPlan(
      { title: "t", goal: "g", steps: [{ title: "s1", toolName: "create_directory", path: "d" }] },
      CTX
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.status).toBe("proposed");
    expect(r.plan.planId).toBe("plan-call-1");
    expect(r.plan.steps[0].id).toBe("step-1");
    expect(r.plan.steps[0].done).toBe(false);
    expect(r.plan.deviationCount).toBe(0);
  });
  it("空步骤/超长标题 → 拒绝", () => {
    expect(buildExecutionPlan({ title: "t", steps: [] }, CTX).ok).toBe(false);
    expect(buildExecutionPlan({ title: "x".repeat(81), steps: [{ title: "s" }] }, CTX).ok).toBe(false);
  });
  it("文件步骤无锚点 → 拒绝并指引", () => {
    const r = buildExecutionPlan({ title: "t", steps: [{ title: "改", toolName: "patch_text_file" }] }, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("path");
  });
  it("终端步骤无 commandPrefix / GUI 步骤无 action+detail → 拒绝", () => {
    expect(
      buildExecutionPlan({ title: "t", steps: [{ title: "跑", toolName: "run_terminal_command" }] }, CTX).ok
    ).toBe(false);
    expect(
      buildExecutionPlan({ title: "t", steps: [{ title: "点", toolName: "desktop_action" }] }, CTX).ok
    ).toBe(false);
    expect(
      buildExecutionPlan(
        { title: "t", steps: [{ title: "点", toolName: "desktop_action", action: "click", detail: "点确定" }] },
        CTX
      ).ok
    ).toBe(true);
  });
  it("未知 toolName / toolName-capability 不一致 / 会话延续单独成步 → 拒绝", () => {
    expect(
      buildExecutionPlan({ title: "t", steps: [{ title: "x", toolName: "nope_tool", path: "a" }] }, CTX).ok
    ).toBe(false);
    expect(
      buildExecutionPlan(
        { title: "t", steps: [{ title: "x", toolName: "create_directory", capability: "fs.delete", path: "a" }] },
        CTX
      ).ok
    ).toBe(false);
    expect(
      buildExecutionPlan({ title: "t", steps: [{ title: "等", toolName: "wait_terminal_command" }] }, CTX).ok
    ).toBe(false);
  });
  it("纯说明步骤（无 tool/capability）允许", () => {
    const r = buildExecutionPlan({ title: "t", steps: [{ title: "先确认需求", detail: "与用户对齐" }] }, CTX);
    expect(r.ok).toBe(true);
  });
  it("deriveStepCapability 按 registry 派生", () => {
    expect(deriveStepCapability("patch_text_file")).toBe("fs.modify");
    expect(deriveStepCapability("run_terminal_command")).toBe("shell.execute");
    expect(deriveStepCapability("nope")).toBeNull();
  });
  it("validatePlanStepAnchors 纯说明步骤通过", () => {
    expect(validatePlanStepAnchors({ title: "说明" }, 0)).toBeNull();
  });
});

describe("runProposeExecutionPlanTool（executor 接入）", () => {
  it("无 sink → PLAN_SINK_UNAVAILABLE；无会话 → PLAN_NO_CONVERSATION", () => {
    const input = { title: "t", steps: [{ title: "s", toolName: "create_directory", path: "d" }] };
    const noSink = runProposeExecutionPlanTool({ toolCallId: "c", toolInput: input, conversationId: "v" });
    expect(noSink.kind).toBe("completed");
    if (noSink.kind !== "completed" || noSink.output.ok) throw new Error("unreachable");
    expect(noSink.output.code).toBe("PLAN_SINK_UNAVAILABLE");
    const noConv = runProposeExecutionPlanTool({
      toolCallId: "c",
      toolInput: input,
      conversationId: "",
      sink: () => {},
    });
    if (noConv.kind !== "completed" || noConv.output.ok) throw new Error("unreachable");
    expect(noConv.output.code).toBe("PLAN_NO_CONVERSATION");
  });
  it("合法 → sink 收到计划 + ok 数据", () => {
    const seen: PersistedExecutionPlan[] = [];
    const r = runProposeExecutionPlanTool({
      toolCallId: "call-9",
      toolInput: { title: "t", steps: [{ title: "s", toolName: "create_directory", path: "d" }] },
      conversationId: "conv-9",
      sink: (p) => seen.push(p),
    });
    expect(r.kind).toBe("completed");
    if (r.kind !== "completed" || !r.output.ok) throw new Error("unreachable");
    expect((r.output.data as { planId: string }).planId).toBe("plan-call-9");
    expect(seen).toHaveLength(1);
    expect(seen[0].conversationId).toBe("conv-9");
  });
  it("非法 → PLAN_REJECTED（错误可读，给模型修正）", () => {
    const r = runProposeExecutionPlanTool({
      toolCallId: "c",
      toolInput: { title: "t", steps: [{ title: "跑", toolName: "run_terminal_command" }] },
      conversationId: "v",
      sink: () => {},
    });
    if (r.kind !== "completed" || r.output.ok) throw new Error("unreachable");
    expect(r.output.code).toBe("PLAN_REJECTED");
    expect(r.output.message).toContain("commandPrefix");
  });
});

describe("extractPlanCallFacts", () => {
  it("文件/移动/终端/GUI 输入抽取事实", () => {
    expect(extractPlanCallFacts("create_text_file", { path: "docs/a.txt", content: "x" })).toMatchObject({
      toolName: "create_text_file",
      capability: "fs.create",
      paths: ["docs/a.txt"],
    });
    expect(
      extractPlanCallFacts("move_file", { rootId: "o", path: "a.txt", destinationRootId: "o", destinationPath: "b.txt" })
    ).toMatchObject({ capability: "fs.move", rootId: "o", paths: ["a.txt", "b.txt"] });
    expect(
      extractPlanCallFacts("run_terminal_command", { shell: "powershell", command: "  npm test -- --run " })
    ).toMatchObject({ capability: "shell.execute", command: "npm test -- --run" });
    expect(
      extractPlanCallFacts("desktop_action", {
        action: "click",
        observationId: "obs-1",
        target: { elementId: "el-3" },
      })
    ).toMatchObject({
      capability: "ui.interact",
      action: "click",
    });
  });
  it("只读工具/未知工具/非法输入 → null（门放行，executor 照常处理）", () => {
    expect(extractPlanCallFacts("read_text", { path: "a" })).toBeNull();
    expect(extractPlanCallFacts("nope", {})).toBeNull();
    expect(extractPlanCallFacts("create_text_file", { content: "x" })).toBeNull();
    expect(extractPlanCallFacts("propose_execution_plan", { title: "t", steps: [] })).toBeNull();
  });
  it("normalizePlanPath 归一", () => {
    expect(normalizePlanPath(" docs\\a.txt ")).toBe("docs/a.txt");
    expect(normalizePlanPath("./x/")).toBe("x");
  });
});

describe("matchPlanStep", () => {
  it("路径精确/前缀/命令前缀命中；done 跳过；顺序无关", () => {
    const plan = approvedPlan();
    const f1 = extractPlanCallFacts("create_directory", { path: "docs" });
    expect(f1 && matchPlanStep(plan, f1).matchedStepId).toBe("step-1");
    const f2 = extractPlanCallFacts("create_text_file", { path: "docs/a.txt", content: "x" });
    expect(f2 && matchPlanStep(plan, f2).matchedStepId).toBe("step-2");
    const f3 = extractPlanCallFacts("run_terminal_command", { shell: "powershell", command: "npm test -- --run x" });
    expect(f3 && matchPlanStep(plan, f3).matchedStepId).toBe("step-3");
    // done 后跳过
    const donePlan: PersistedExecutionPlan = {
      ...plan,
      steps: plan.steps.map((s) => (s.id === "step-1" ? { ...s, done: true } : s)),
    };
    expect(f1 && matchPlanStep(donePlan, f1).matchedStepId).toBeNull();
  });
  it("路径不符/rootId 不符/命令前缀不符 → 偏离 null", () => {
    const plan = approvedPlan();
    const other = extractPlanCallFacts("create_text_file", { path: "other/b.txt", content: "x" });
    expect(other && matchPlanStep(plan, other).matchedStepId).toBeNull();
    const planWithRoot: PersistedExecutionPlan = {
      ...plan,
      steps: [{ id: "step-1", title: "删", toolName: "delete_file", rootId: "o1", path: "a.txt", done: false }],
    };
    const wrongRoot = extractPlanCallFacts("delete_file", { rootId: "o2", path: "a.txt" });
    expect(wrongRoot && matchPlanStep(planWithRoot, wrongRoot).matchedStepId).toBeNull();
    const wrongCmd = extractPlanCallFacts("run_terminal_command", { shell: "powershell", command: "rm -rf x" });
    expect(wrongCmd && matchPlanStep(plan, wrongCmd).matchedStepId).toBeNull();
  });
  it("无锚点宽泛步骤不放行文件调用（防宽泛计划）", () => {
    const built = buildExecutionPlan(
      { title: "t", steps: [{ title: "文件操作", capability: "fs.create", detail: "做点文件操作" }] },
      CTX
    );
    // propose 期即拒绝（文件类无锚点）
    expect(built.ok).toBe(false);
  });
  it("handle 延续归属 shell 步骤；计划无 shell 步骤 → 偏离", () => {
    const plan = approvedPlan();
    expect(matchPlanStep(plan, { toolName: "wait_terminal_command", capability: "shell.execute", paths: [] }).matchedStepId).toBe(
      "step-3"
    );
    const noShell: PersistedExecutionPlan = {
      ...plan,
      steps: [{ id: "step-1", title: "建", toolName: "create_directory", path: "d", done: false }],
    };
    expect(
      matchPlanStep(noShell, { toolName: "wait_terminal_command", capability: "shell.execute", paths: [] }).matchedStepId
    ).toBeNull();
  });
});
