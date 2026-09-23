// @vitest-environment node
/**
 * P5 — Desktop Session Presentation Domain 纯函数测试。
 *
 * 覆盖：状态文案（app 优先级 / acting 动作映射）、tone 语义（paused / approval / reflection
 * 不是错误）、控制可用性（approval-required 不提供 Pause；terminal 无控制）、进度格式。
 */
import { describe, it, expect } from "vitest";
import {
  describeDesktopActionLabel,
  describeDesktopSessionState,
  formatDesktopSessionProgress,
  isDesktopSessionActiveState,
  isDesktopSessionTerminalState,
  resolveDesktopSessionApp,
  resolveDesktopSessionControls,
  resolveDesktopSessionTone,
} from "@/lib/ai/ui/kiroComputerSession";

describe("describeDesktopSessionState", () => {
  it("observing → 正在查看 <app>", () => {
    expect(
      describeDesktopSessionState({
        state: "observing",
        appName: "wechat",
        windowTitle: "微信",
        actionLabel: null,
        appProfile: { id: "im", label: "微信", blocked: false },
      })
    ).toBe("正在查看 微信");
  });

  it("acting → 动作 + 应用（appProfile.label 优先，其次 appName，其次 windowTitle，最终 桌面）", () => {
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: "wechat",
        windowTitle: "文件传输助手",
        actionLabel: "click el-1",
        appProfile: { id: "im", label: "微信", blocked: false },
      })
    ).toBe("正在点击 · 微信");
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: "winword",
        windowTitle: "报告.docx",
        actionLabel: "type el-2",
        appProfile: null,
      })
    ).toBe("正在输入 · winword");
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: null,
        windowTitle: "浏览器",
        actionLabel: "scroll el-3",
        appProfile: null,
      })
    ).toBe("正在滚动 · 浏览器");
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: null,
        windowTitle: null,
        actionLabel: null,
        appProfile: null,
      })
    ).toBe("正在操作界面 · 桌面");
  });

  it("窗口 / 应用级动作本身就是完整语义", () => {
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: "wechat",
        windowTitle: "微信",
        actionLabel: "window:activate el-1",
        appProfile: { id: "im", label: "微信", blocked: false },
      })
    ).toBe("正在切换窗口");
    expect(
      describeDesktopSessionState({
        state: "acting",
        appName: "wechat",
        windowTitle: "微信",
        actionLabel: "app:open wechat",
        appProfile: { id: "im", label: "微信", blocked: false },
      })
    ).toBe("正在打开应用");
  });

  it("waiting / approval-required / paused / terminal 文案", () => {
    const base = { appName: "wechat", windowTitle: "微信", actionLabel: null, appProfile: null };
    expect(describeDesktopSessionState({ ...base, state: "waiting" })).toBe("正在等待界面响应");
    expect(describeDesktopSessionState({ ...base, state: "approval-required" })).toBe("等待你的确认");
    expect(describeDesktopSessionState({ ...base, state: "paused" })).toBe("已暂停");
    expect(describeDesktopSessionState({ ...base, state: "completed" })).toBe("电脑操作已完成");
    expect(describeDesktopSessionState({ ...base, state: "failed" })).toBe("电脑操作已停止");
    expect(describeDesktopSessionState({ ...base, state: "cancelled" })).toBe("已停止");
  });

  it("describeDesktopActionLabel：覆盖主要动作（不泄漏坐标 / 元素 id）", () => {
    expect(describeDesktopActionLabel("click el-1")).toBe("正在点击");
    expect(describeDesktopActionLabel("double_click el-1")).toBe("正在双击");
    expect(describeDesktopActionLabel("right_click el-1")).toBe("正在右键操作");
    expect(describeDesktopActionLabel("key enter")).toBe("正在按键");
    expect(describeDesktopActionLabel("clipboard_read")).toBe("正在读取剪贴板");
    expect(describeDesktopActionLabel("upload_file el-9")).toBe("正在填入文件");
    expect(describeDesktopActionLabel("wait 800")).toBe("正在等待");
    expect(describeDesktopActionLabel(null)).toBe("正在操作界面");
  });

  it("resolveDesktopSessionApp 优先级", () => {
    expect(resolveDesktopSessionApp({ appName: "a", windowTitle: "b", appProfile: { id: "x", label: "微信", blocked: false } })).toBe("微信");
    expect(resolveDesktopSessionApp({ appName: "a", windowTitle: "b", appProfile: null })).toBe("a");
    expect(resolveDesktopSessionApp({ appName: null, windowTitle: "b", appProfile: null })).toBe("b");
    expect(resolveDesktopSessionApp({ appName: null, windowTitle: null, appProfile: null })).toBe("桌面");
  });
});

describe("resolveDesktopSessionTone：语义化（不是所有非正常态都是错误）", () => {
  it("active 状态 → active；reflection → warning", () => {
    expect(resolveDesktopSessionTone({ state: "observing" })).toBe("active");
    expect(resolveDesktopSessionTone({ state: "acting" })).toBe("active");
    expect(resolveDesktopSessionTone({ state: "waiting" })).toBe("active");
    expect(resolveDesktopSessionTone({ state: "observing", reflectionRequired: true })).toBe("warning");
  });

  it("approval-required → warning；paused → muted（都不是 danger）", () => {
    expect(resolveDesktopSessionTone({ state: "approval-required" })).toBe("warning");
    expect(resolveDesktopSessionTone({ state: "paused" })).toBe("muted");
  });

  it("completed → success；failed → danger；cancelled → neutral（用户主动停止不是错误）", () => {
    expect(resolveDesktopSessionTone({ state: "completed" })).toBe("success");
    expect(resolveDesktopSessionTone({ state: "failed" })).toBe("danger");
    expect(resolveDesktopSessionTone({ state: "cancelled" })).toBe("neutral");
  });
});

describe("resolveDesktopSessionControls", () => {
  it("active → Pause + Stop；approval-required → 只有 Stop（不显示 Pause）", () => {
    expect(resolveDesktopSessionControls({ state: "acting" })).toEqual({
      canPause: true,
      canResume: false,
      canStop: true,
    });
    expect(resolveDesktopSessionControls({ state: "observing" })).toEqual({
      canPause: true,
      canResume: false,
      canStop: true,
    });
    expect(resolveDesktopSessionControls({ state: "approval-required" })).toEqual({
      canPause: false,
      canResume: false,
      canStop: true,
    });
  });

  it("paused → Resume + Stop（无 Pause）；terminal → 无控制", () => {
    expect(resolveDesktopSessionControls({ state: "paused" })).toEqual({
      canPause: false,
      canResume: true,
      canStop: true,
    });
    for (const state of ["completed", "failed", "cancelled"] as const) {
      expect(resolveDesktopSessionControls({ state })).toEqual({
        canPause: false,
        canResume: false,
        canStop: false,
      });
    }
  });
});

describe("formatDesktopSessionProgress", () => {
  it("plan 非空 → 第 N/M 步 + 当前步骤", () => {
    expect(
      formatDesktopSessionProgress({
        plan: ["打开微信", "找到文件传输助手", "发送文件"],
        stepIndex: 1,
        goal: "发送报告",
      })
    ).toEqual({ stepLabel: "第 2/3 步", currentStep: "找到文件传输助手" });
  });

  it("stepIndex 越界 → clamp", () => {
    expect(
      formatDesktopSessionProgress({ plan: ["a", "b"], stepIndex: 9, goal: null })
    ).toEqual({ stepLabel: "第 2/2 步", currentStep: "b" });
  });

  it("plan 为空 → 只显示 goal；都为空 → 都不显示", () => {
    expect(formatDesktopSessionProgress({ plan: [], stepIndex: 0, goal: "发送报告" })).toEqual({
      stepLabel: null,
      currentStep: "发送报告",
    });
    expect(formatDesktopSessionProgress({ plan: [], stepIndex: 0, goal: null })).toEqual({
      stepLabel: null,
      currentStep: null,
    });
  });
});

describe("terminal / active 判定", () => {
  it("terminal = completed / failed / cancelled", () => {
    expect(isDesktopSessionTerminalState("completed")).toBe(true);
    expect(isDesktopSessionTerminalState("failed")).toBe(true);
    expect(isDesktopSessionTerminalState("cancelled")).toBe(true);
    expect(isDesktopSessionTerminalState("paused")).toBe(false);
    expect(isDesktopSessionActiveState("approval-required")).toBe(true);
  });
});
