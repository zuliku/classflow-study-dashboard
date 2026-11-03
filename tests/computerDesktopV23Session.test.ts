// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DesktopControlSessionStore,
  DESKTOP_SESSION_LIMITS,
} from "@/src/main/computer/session";
import {
  normalizeSessionPlanInput,
  DesktopComputerIpcError,
} from "@/src/main/computer/observation";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

describe("V2.3 DesktopControlSessionStore — 目标 / 计划 / 步骤", () => {
  it("set_goal / update_plan / complete_step / set_step", () => {
    const store = new DesktopControlSessionStore();
    store.updatePlan(SESSION, { goal: "在浏览器搜索 ClassFlow" }, 0);
    expect(store.get(SESSION, 0)?.goal).toBe("在浏览器搜索 ClassFlow");

    store.updatePlan(SESSION, { plan: ["打开浏览器", "搜索", "读取结果"] }, 0);
    expect(store.get(SESSION, 0)?.plan).toEqual(["打开浏览器", "搜索", "读取结果"]);
    expect(store.get(SESSION, 0)?.stepIndex).toBe(0);

    store.updatePlan(SESSION, { completeStep: true }, 0);
    expect(store.get(SESSION, 0)?.stepIndex).toBe(1);
    store.updatePlan(SESSION, { completeStep: true }, 0);
    store.updatePlan(SESSION, { completeStep: true }, 0);
    // 到最后一步后不再越界
    expect(store.get(SESSION, 0)?.stepIndex).toBe(2);

    store.updatePlan(SESSION, { stepIndex: 0 }, 0);
    expect(store.get(SESSION, 0)?.stepIndex).toBe(0);
  });

  it("计划有界：≤8 步、每步 ≤80 字符（store 层截断）", () => {
    const store = new DesktopControlSessionStore();
    store.updatePlan(
      SESSION,
      {
        plan: Array.from({ length: 12 }, (_, i) => `步骤 ${i} `.repeat(30)),
      },
      0
    );
    const status = store.get(SESSION, 0)!;
    expect(status.plan.length).toBeLessThanOrEqual(DESKTOP_SESSION_LIMITS.maxPlanSteps);
    for (const step of status.plan) {
      expect(step.length).toBeLessThanOrEqual(DESKTOP_SESSION_LIMITS.maxPlanStepLength);
    }
  });

  it("连续 2 次验证失败 → reflectionRequired；通过则清零", () => {
    const store = new DesktopControlSessionStore();
    store.recordVerification(SESSION, false, 0);
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(false);
    store.recordVerification(SESSION, false, 0);
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(true);

    // 通过验证清零 failStreak（但 reflectionRequired 需要重新规划来消费）
    store.recordVerification(SESSION, true, 0);
    expect(store.reflectionSnapshot(SESSION).failStreak).toBe(0);
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(true);

    // update_plan = 重新规划 → 消费 reflectionRequired
    store.updatePlan(SESSION, { plan: ["换一种方式"] }, 0);
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(false);
  });

  it("未配置 expect（null）不参与失败计数", () => {
    const store = new DesktopControlSessionStore();
    store.ensure(SESSION, 0);
    store.recordVerification(SESSION, null, 0);
    store.recordVerification(SESSION, null, 0);
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(false);
  });

  it("no-progress（UI 指纹不变）→ reflectionRequired", () => {
    const store = new DesktopControlSessionStore();
    store.beginAction(SESSION, { fingerprint: "click:el-1", actionLabel: "点击", appName: null, windowTitle: null }, 0);
    store.endAction(
      SESSION,
      { beforeUiSignature: "same", newUiSignature: "same", ok: true, actionFingerprint: "click:el-1" },
      0
    );
    expect(store.get(SESSION, 0)?.reflectionRequired).toBe(true);
    expect(store.reflectionSnapshot(SESSION).noProgress).toBe(1);
  });

  it("status 与 session 事件都携带 goal/plan/stepIndex/reflectionRequired", async () => {
    const events: Array<{ plan: string[]; stepIndex: number; goal: string | null; reflectionRequired: boolean }> = [];
    const store = new DesktopControlSessionStore();
    store.setEmitter((event) => {
      events.push({
        plan: event.plan,
        stepIndex: event.stepIndex,
        goal: event.goal,
        reflectionRequired: event.reflectionRequired,
      });
    });
    store.updatePlan(SESSION, { goal: "目标", plan: ["A", "B"] }, 0);
    const status = store.get(SESSION, 0)!;
    expect(status.goal).toBe("目标");
    expect(status.plan).toEqual(["A", "B"]);
    expect(status.stepIndex).toBe(0);
    expect(status.reflectionRequired).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events.at(-1)).toMatchObject({ goal: "目标", plan: ["A", "B"], stepIndex: 0 });
  });
});

describe("V2.3 normalizeSessionPlanInput — malformed 输入 fail closed", () => {
  it("合法输入归一", () => {
    expect(
      normalizeSessionPlanInput({ sessionId: SESSION, goal: "  搜索 ClassFlow  " })
    ).toMatchObject({ goal: "搜索 ClassFlow" });
    expect(
      normalizeSessionPlanInput({ sessionId: SESSION, plan: [" 第一步 ", "第二步"] })
    ).toMatchObject({ plan: ["第一步", "第二步"] });
    expect(normalizeSessionPlanInput({ sessionId: SESSION, completeStep: true })).toMatchObject({
      completeStep: true,
    });
    expect(normalizeSessionPlanInput({ sessionId: SESSION, stepIndex: 3 })).toMatchObject({ stepIndex: 3 });
  });

  it.each([
    ["非对象", null],
    ["非法 sessionId", { sessionId: "nope", goal: "x" }],
    ["空 goal", { sessionId: SESSION, goal: "   " }],
    ["未知字段", { sessionId: SESSION, goal: "x", hwnd: 1 }],
    ["无任何字段", { sessionId: SESSION }],
    ["plan 为空数组", { sessionId: SESSION, plan: [] }],
    ["plan 超 8 步", { sessionId: SESSION, plan: Array.from({ length: 9 }, (_, i) => `s${i}`) }],
    ["plan 步骤超长", { sessionId: SESSION, plan: ["x".repeat(81)] }],
    ["stepIndex 越界", { sessionId: SESSION, stepIndex: 8 }],
    ["completeStep 非 boolean", { sessionId: SESSION, completeStep: "yes" }],
  ])("%s → INVALID_OPERATION", (_label, input) => {
    try {
      normalizeSessionPlanInput(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DesktopComputerIpcError);
      expect((err as DesktopComputerIpcError).code).toBe("INVALID_OPERATION");
    }
  });
});
