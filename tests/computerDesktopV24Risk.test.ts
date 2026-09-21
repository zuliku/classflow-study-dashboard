// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyGuiAction, isHighRiskGuiLevel, type GuiRiskProfileHint } from "@/lib/ai/computer/gui/risk";

const IM_HINT: GuiRiskProfileHint = {
  id: "im",
  label: "即时通讯",
  blocked: false,
  reason: null,
  riskyNamePatterns: ["发送", "转账", "红包", "pay"],
};

const BLOCKED_HINT: GuiRiskProfileHint = {
  id: "password-manager",
  label: "密码管理器",
  blocked: true,
  reason: "该应用属于密码 / 凭据管理器，Kiro 不会操作",
  riskyNamePatterns: [],
};

function classify(overrides: {
  action?: "click" | "type" | "key";
  name?: string;
  appName?: string;
  profile?: GuiRiskProfileHint;
}) {
  return classifyGuiAction({
    action: overrides.action ?? "click",
    target: {
      kind: "element",
      role: "Button",
      name: overrides.name ?? "确定",
      isPassword: false,
      appName: overrides.appName ?? "wechat",
      windowTitle: "微信",
    },
    ...(overrides.profile ? { profile: overrides.profile } : {}),
  });
}

describe("V2.4 GUI Risk — 应用画像 blocked", () => {
  it("blocked 画像 → blocked（审批也不放行）+ 画像原因", () => {
    const decision = classify({ profile: BLOCKED_HINT, appName: "bitwarden" });
    expect(decision.level).toBe("blocked");
    expect(decision.reason).toContain("密码");
    expect(decision.textPreview).toBeNull();
  });

  it("blocked 画像优先于普通控件（即便控件名无风险）", () => {
    const decision = classify({ profile: BLOCKED_HINT, name: "显示密码" });
    expect(decision.level).toBe("blocked");
  });

  it("blocked 画像 reason 缺失时使用 label 兜底", () => {
    const decision = classify({
      profile: { ...BLOCKED_HINT, reason: null },
    });
    expect(decision.level).toBe("blocked");
    expect(decision.reason).toContain("密码管理器");
  });
});

describe("V2.4 GUI Risk — 应用内高风险控件（画像模式）", () => {
  it("微信「转账」→ external（画像模式命中，需要逐次确认）", () => {
    const decision = classify({ profile: IM_HINT, name: "转账" });
    expect(decision.level).toBe("external");
    expect(decision.reason).toContain("即时通讯");
    expect(isHighRiskGuiLevel(decision.level)).toBe(true);
  });

  it("画像模式大小写不敏感（pay / Pay）", () => {
    expect(classify({ profile: IM_HINT, name: "Pay Now" }).level).toBe("external");
    expect(classify({ profile: IM_HINT, name: "PAY" }).level).toBe("external");
  });

  it("画像模式不命中时保持普通（不误报）", () => {
    const decision = classify({ profile: IM_HINT, name: "联系人列表" });
    expect(decision.level).toBe("normal");
  });

  it("destructive 名称仍优先于画像模式（更严格）", () => {
    const decision = classify({ profile: IM_HINT, name: "删除并退出" });
    expect(decision.level).toBe("destructive");
  });

  it("无画像时行为不变（回归）", () => {
    expect(classify({ name: "发送" }).level).toBe("external");
    expect(classify({ name: "联系人" }).level).toBe("normal");
  });

  it("非法 / 超长画像模式被忽略（不抛错）", () => {
    const decision = classify({
      profile: { ...IM_HINT, riskyNamePatterns: ["[", "x".repeat(200), "转账"] },
      name: "转账",
    });
    expect(decision.level).toBe("external");
  });
});
