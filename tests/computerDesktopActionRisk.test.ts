// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyGuiAction, looksLikeCredentialString } from "@/lib/ai/computer/gui/risk";
import { parseGuiKey, isAllowedGuiKey, guiKeyToVirtualKeys } from "@/lib/ai/computer/gui/keymap";

function ctx(overrides: Partial<Parameters<typeof classifyGuiAction>[0]> = {}) {
  return {
    action: "click" as const,
    target: {
      kind: "element" as const,
      role: "Button",
      name: "",
      isPassword: false,
      appName: "chrome",
      windowTitle: "搜索 - Google Chrome",
    },
    ...overrides,
  };
}

describe("GUI Risk Classifier — normal", () => {
  it("普通 click（tab / 普通按钮）→ normal", () => {
    expect(classifyGuiAction(ctx({ target: { ...ctx().target, name: "搜索标签页" } })).level).toBe("normal");
  });

  it("普通 type（搜索词）→ normal 且有非敏感预览", () => {
    const decision = classifyGuiAction(
      ctx({
        action: "type",
        text: "ClassFlow",
        target: { ...ctx().target, role: "Edit", name: "搜索" },
      })
    );
    expect(decision.level).toBe("normal");
    expect(decision.textPreview).toBe("ClassFlow");
  });

  it("scroll / focus → normal", () => {
    expect(classifyGuiAction(ctx({ action: "scroll" })).level).toBe("normal");
    expect(classifyGuiAction(ctx({ action: "focus" })).level).toBe("normal");
  });

  it("普通 enter（无风险元素）→ normal", () => {
    expect(
      classifyGuiAction(
        ctx({ action: "key", key: "enter", target: { ...ctx().target, role: "Edit", name: "搜索" } })
      ).level
    ).toBe("normal");
  });
});

describe("GUI Risk Classifier — external / destructive（强制确认）", () => {
  it.each(["发送", "提交", "发布", "下载", "购买", "确认支付", "Send", "Submit"])(
    "目标「%s」→ external",
    (name) => {
      expect(classifyGuiAction(ctx({ target: { ...ctx().target, name } })).level).toBe("external");
    }
  );

  it.each(["删除", "卸载", "格式化", "清空", "Delete", "Uninstall"])(
    "目标「%s」→ destructive",
    (name) => {
      expect(classifyGuiAction(ctx({ target: { ...ctx().target, name } })).level).toBe("destructive");
    }
  );

  it("坐标回退 click → external（需要确认）", () => {
    const decision = classifyGuiAction(
      ctx({ target: { ...ctx().target, kind: "coordinates", name: undefined as unknown as string } })
    );
    expect(decision.level).toBe("external");
  });

  it("type 未指定元素（当前焦点）→ external", () => {
    const decision = classifyGuiAction(
      ctx({ action: "type", text: "hello", target: { ...ctx().target, kind: "none" } })
    );
    expect(decision.level).toBe("external");
  });

  it("enter 落在发送类元素 → external（最终确认型）", () => {
    const decision = classifyGuiAction(
      ctx({ action: "key", key: "enter", target: { ...ctx().target, name: "发送消息" } })
    );
    expect(decision.level).toBe("external");
  });

  it("alt+f4 → destructive；ctrl+s → external", () => {
    expect(classifyGuiAction(ctx({ action: "key", key: "alt+f4" })).level).toBe("destructive");
    expect(classifyGuiAction(ctx({ action: "key", key: "ctrl+s" })).level).toBe("external");
  });

  it("系统设置 / 终端类窗口 → external", () => {
    expect(
      classifyGuiAction(ctx({ target: { ...ctx().target, appName: "SystemSettings" } })).level
    ).toBe("external");
    expect(classifyGuiAction(ctx({ target: { ...ctx().target, appName: "cmd" } })).level).toBe("external");
  });
});

describe("GUI Risk Classifier — blocked（审批也不放行）", () => {
  it("密码字段输入 → blocked，且无文本预览", () => {
    const decision = classifyGuiAction(
      ctx({
        action: "type",
        text: "hunter2",
        target: { ...ctx().target, role: "Edit", name: "密码", isPassword: true },
      })
    );
    expect(decision.level).toBe("blocked");
    expect(decision.textPreview).toBeNull();
  });

  it.each([
    "my password is 123456",
    "api_key=abcdef123456",
    "Bearer eyJhbGciOiJIUzI1NiIs",
    "token: ghp_abcdefgh12345678",
    "sk-abcdefgh12345678",
  ])("疑似凭据文本 %s → blocked", (text) => {
    const decision = classifyGuiAction(
      ctx({ action: "type", text, target: { ...ctx().target, role: "Edit", name: "输入" } })
    );
    expect(decision.level).toBe("blocked");
    expect(decision.textPreview).toBeNull();
  });

  it("高熵字符串 → sensitive（需要确认，预览隐藏）", () => {
    const decision = classifyGuiAction(
      ctx({
        action: "type",
        text: "aB3$xY9!kL2@mN4#pQ6zR7vW8",
        target: { ...ctx().target, role: "Edit", name: "输入" },
      })
    );
    expect(decision.level).toBe("sensitive");
    expect(decision.textPreview).toBeNull();
  });

  it.each(["ctrl+c", "ctrl+v", "ctrl+x", "win+r", "win+x", "ctrl+alt+del", "ctrl+shift+esc"])(
    "%s → blocked",
    (key) => {
      expect(classifyGuiAction(ctx({ action: "key", key })).level).toBe("blocked");
    }
  );

  it("系统安全 / 凭据界面（consent）→ blocked", () => {
    expect(classifyGuiAction(ctx({ target: { ...ctx().target, appName: "consent" } })).level).toBe("blocked");
    expect(classifyGuiAction(ctx({ target: { ...ctx().target, appName: "LogonUI" } })).level).toBe("blocked");
  });

  it("不在 allowlist 的按键 → blocked", () => {
    expect(classifyGuiAction(ctx({ action: "key", key: "volumeup" })).level).toBe("blocked");
  });
});

describe("GUI keymap allowlist", () => {
  it("合法按键解析 + VK 映射", () => {
    expect(parseGuiKey("enter")?.name).toBe("enter");
    expect(parseGuiKey("ESC")?.name).toBe("escape");
    expect(parseGuiKey("Ctrl+A")?.name).toBe("ctrl+a");
    expect(guiKeyToVirtualKeys("ctrl+a")).toEqual([0x11, 0x41]);
    expect(guiKeyToVirtualKeys("enter")).toEqual([0x0d]);
    expect(guiKeyToVirtualKeys("f5")).toEqual([0x74]);
  });

  it.each(["", "ctrl", "shift", "ctrl+c", "win+r", "meta+l", "unknown-key", "ctrl+alt+delete"])(
    "非法 / blocked 按键 %j → 拒绝",
    (key) => {
      expect(isAllowedGuiKey(key)).toBe(false);
      expect(guiKeyToVirtualKeys(key)).toBeNull();
    }
  );

  it("looksLikeCredentialString 边界", () => {
    expect(looksLikeCredentialString("ClassFlow")).toBe(false);
    expect(looksLikeCredentialString("this is a normal sentence")).toBe(false);
    expect(looksLikeCredentialString("aB3$xY9!kL2@mN4#pQ6zR7vW8")).toBe(true);
  });
});
