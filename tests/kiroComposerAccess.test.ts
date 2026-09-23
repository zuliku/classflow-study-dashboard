// @vitest-environment node
/**
 * Kiro Composer P3 — Access / Model 纯函数测试。
 */
import { describe, it, expect } from "vitest";
import {
  COMPOSER_ACCESS_COPY,
  COMPOSER_ACCESS_MODES,
  composerAccessAgentMode,
  composerAccessRequiresComputer,
  isComposerAccessDanger,
  resolveComposerAccessLabel,
  resolveComposerAccessState,
} from "@/components/kiro/composer/KiroComposerAccess";
import {
  isComposerReasoningAdjustable,
  reasoningEffortLabel,
  reasoningStepIndex,
} from "@/components/kiro/composer/KiroComposerModel";
import { FIXED_REASONING, type ReasoningCapability } from "@/lib/ai/reasoning/types";

const ADJUSTABLE: ReasoningCapability = {
  adjustable: true,
  supportedEfforts: ["default", "low", "medium", "high", "xhigh"],
  mechanism: "effort",
};

describe("resolveComposerAccessState / Label（四态映射）", () => {
  it("Computer OFF → 仅对话（忽略 agentMode）", () => {
    expect(resolveComposerAccessState({ computerEnabled: false, agentMode: "guided" })).toBe("chat");
    expect(resolveComposerAccessLabel(false, "guided")).toBe("仅对话");
    expect(resolveComposerAccessLabel(false, "workspace-auto")).toBe("仅对话");
    expect(resolveComposerAccessLabel(false, "plan")).toBe("仅对话");
  });

  it("plan → 仅规划；guided → 受控访问；workspace-auto → 自动执行", () => {
    expect(resolveComposerAccessLabel(true, "plan")).toBe("仅规划");
    expect(resolveComposerAccessLabel(true, "guided")).toBe("受控访问");
    expect(resolveComposerAccessLabel(true, "workspace-auto")).toBe("自动执行");
  });

  it("copy 表覆盖四态且描述克制", () => {
    expect(COMPOSER_ACCESS_MODES).toEqual(["chat", "plan", "guided", "workspace-auto"]);
    expect(COMPOSER_ACCESS_COPY.chat.description).toBe("不使用 Computer 工具");
    expect(COMPOSER_ACCESS_COPY.guided.description).toBe("执行关键操作时请求确认");
    expect(COMPOSER_ACCESS_COPY["workspace-auto"].description).toBe("在授权范围内自动工作");
  });

  it("仅 workspace-auto 使用 danger semantic", () => {
    expect(isComposerAccessDanger("workspace-auto")).toBe(true);
    expect(isComposerAccessDanger("chat")).toBe(false);
    expect(isComposerAccessDanger("plan")).toBe(false);
    expect(isComposerAccessDanger("guided")).toBe(false);
  });

  it("requiresComputer / agentMode 映射（chat → 关闭 Computer，不写 mode）", () => {
    expect(composerAccessRequiresComputer("chat")).toBe(false);
    expect(composerAccessRequiresComputer("plan")).toBe(true);
    expect(composerAccessAgentMode("chat")).toBeNull();
    expect(composerAccessAgentMode("plan")).toBe("plan");
    expect(composerAccessAgentMode("guided")).toBe("guided");
    expect(composerAccessAgentMode("workspace-auto")).toBe("workspace-auto");
  });
});

describe("Reasoning 滑块（steps / index）", () => {
  it("fixed / 单档 → 不可调（不渲染滑块）", () => {
    expect(isComposerReasoningAdjustable(FIXED_REASONING)).toBe(false);
    const single: ReasoningCapability = { adjustable: true, supportedEfforts: ["default"], mechanism: "effort" };
    expect(isComposerReasoningAdjustable(single)).toBe(false);
    expect(isComposerReasoningAdjustable(null)).toBe(false);
  });

  it("可调 → 档位索引与 supportedEfforts 一致；未知档位回退 0", () => {
    const steps = ADJUSTABLE.supportedEfforts;
    expect(reasoningStepIndex(steps, "default")).toBe(0);
    expect(reasoningStepIndex(steps, "high")).toBe(3);
    expect(reasoningStepIndex(steps, "max")).toBe(0);
  });

  it("effort label 单一来源", () => {
    expect(reasoningEffortLabel("default")).toBe("默认");
    expect(reasoningEffortLabel("high")).toBe("高");
    expect(reasoningEffortLabel("xhigh")).toBe("超高");
    expect(reasoningEffortLabel("max")).toBe("极高");
  });
});