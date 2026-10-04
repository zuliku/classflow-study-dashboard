// @vitest-environment node
/**
 * Kiro Agent Run V1（P4）— 纯函数测试。
 *
 * 覆盖：status 推导（优先级 / 事实来源）、Header 文案、真实 duration（绝不伪造）、
 * Result Summary 泛化（Terminal ≠ 文件更改）、Approval Presentation（GUI / Terminal / File /
 * 高危）与 taskId → owning message 精确匹配。
 */
import { describe, it, expect } from "vitest";
import {
  findApprovalOwnerMessageId,
  formatComputerTaskResultSummary,
  formatKiroAgentRunDuration,
  isKiroAgentRunActive,
  isKiroAgentRunTerminal,
  kiroAgentRunHeaderText,
  resolveKiroAgentRunStatus,
  summarizeComputerTaskResult,
} from "@/lib/ai/ui/kiroAgentRun";
import {
  COMPUTER_APPROVAL_DECISION_LABELS,
  getComputerApprovalPresentation,
  isComputerApprovalHighRisk,
} from "@/lib/ai/ui/computerApprovalPresentation";
import type { ComputerApprovalRequest } from "@/lib/ai/computer/approval";

const BASE_RUN = {
  turnInFlight: false,
  waitingApproval: false,
} as const;

describe("resolveKiroAgentRunStatus：只从 Runtime fact 推导", () => {
  it("waiting-approval 最高优先级（即使 turn 已 settled / task failed）", () => {
    expect(
      resolveKiroAgentRunStatus({
        ...BASE_RUN,
        turnInFlight: false,
        taskStatus: "failed",
        waitingApproval: true,
      })
    ).toBe("waiting-approval");
  });

  it("in-flight：working → running；composing / answering → composing", () => {
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, turnInFlight: true, phase: "working" })).toBe("running");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, turnInFlight: true, phase: "composing" })).toBe("composing");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, turnInFlight: true, phase: "answering" })).toBe("composing");
  });

  it("in-flight + Desktop Session paused → paused（高于 running）", () => {
    expect(
      resolveKiroAgentRunStatus({ ...BASE_RUN, turnInFlight: true, phase: "working", desktopPaused: true })
    ).toBe("paused");
    // settled 后 paused 不再表达（session 事实不覆盖终态）
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, desktopPaused: true })).toBe("completed");
  });

  it("in-flight 单步失败/拒绝不把 Run 判为 failed（模型仍会继续处理）", () => {
    expect(
      resolveKiroAgentRunStatus({ ...BASE_RUN, turnInFlight: true, phase: "working", taskStatus: "failed" })
    ).toBe("running");
  });

  it("settled：task failed / cancelled → failed / cancelled；其余 → completed", () => {
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, taskStatus: "failed" })).toBe("failed");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, taskStatus: "cancelled" })).toBe("cancelled");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, taskStatus: "completed" })).toBe("completed");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN, taskStatus: "undone" })).toBe("completed");
    expect(resolveKiroAgentRunStatus({ ...BASE_RUN })).toBe("completed");
  });

  it("active / terminal 分类", () => {
    expect(isKiroAgentRunActive("running")).toBe(true);
    expect(isKiroAgentRunActive("waiting-approval")).toBe(true);
    expect(isKiroAgentRunActive("paused")).toBe(true);
    expect(isKiroAgentRunActive("completed")).toBe(false);
    expect(isKiroAgentRunTerminal("completed")).toBe(true);
    expect(isKiroAgentRunTerminal("failed")).toBe(true);
    expect(isKiroAgentRunTerminal("cancelled")).toBe(true);
  });
});

describe("Header 文案", () => {
  it("running + GUI 操作中 → 正在操作电脑；其余沿用状态文案", () => {
    expect(kiroAgentRunHeaderText("running", { desktopActive: true })).toBe("正在操作电脑");
    expect(kiroAgentRunHeaderText("running")).toBe("正在执行");
    expect(kiroAgentRunHeaderText("composing")).toBe("正在整理回答");
    expect(kiroAgentRunHeaderText("waiting-approval")).toBe("等待你的确认");
    expect(kiroAgentRunHeaderText("paused")).toBe("已暂停");
    expect(kiroAgentRunHeaderText("completed")).toBe("已完成");
    expect(kiroAgentRunHeaderText("failed")).toBe("操作未完成");
    expect(kiroAgentRunHeaderText("cancelled")).toBe("已停止");
    // 非 running 不套用 desktop 文案
    expect(kiroAgentRunHeaderText("composing", { desktopActive: true })).toBe("正在整理回答");
  });
});

describe("真实 duration（绝不伪造）", () => {
  it("只有真实 startedAt/completedAt 才产生用时", () => {
    expect(
      formatKiroAgentRunDuration({ startedAt: "2026-09-23T10:00:00.000Z", completedAt: "2026-09-23T10:00:42.000Z" })
    ).toBe("用时 42s");
    expect(
      formatKiroAgentRunDuration({ startedAt: "2026-09-23T10:00:00.000Z", completedAt: "2026-09-23T10:01:42.000Z" })
    ).toBe("用时 1m 42s");
    expect(
      formatKiroAgentRunDuration({ startedAt: "2026-09-23T10:00:00.000Z", completedAt: "2026-09-23T11:02:00.000Z" })
    ).toBe("用时 1h 2m");
  });

  it("缺时间戳 / 非法 / 倒序 → null（不显示用时）", () => {
    expect(formatKiroAgentRunDuration({})).toBeNull();
    expect(formatKiroAgentRunDuration({ startedAt: "2026-09-23T10:00:00.000Z" })).toBeNull();
    expect(formatKiroAgentRunDuration({ completedAt: "2026-09-23T10:00:00.000Z" })).toBeNull();
    expect(formatKiroAgentRunDuration({ startedAt: "not-a-date", completedAt: "2026-09-23T10:00:00.000Z" })).toBeNull();
    expect(
      formatKiroAgentRunDuration({ startedAt: "2026-09-23T10:01:00.000Z", completedAt: "2026-09-23T10:00:00.000Z" })
    ).toBeNull();
  });
});

describe("Result Summary 泛化（Terminal ≠ 文件更改）", () => {
  it("只文件变更 → 已完成 N 项文件更改", () => {
    expect(
      formatComputerTaskResultSummary({
        status: "completed",
        changes: [{ operation: "create" }, { operation: "modify" }],
      })
    ).toBe("已完成 2 项文件更改");
  });

  it("只 Terminal → 已运行 N 个命令", () => {
    expect(
      formatComputerTaskResultSummary({ status: "completed", changes: [{ operation: "execute" }] })
    ).toBe("已运行 1 个命令");
  });

  it("混合 → 已完成 N 项操作", () => {
    expect(
      formatComputerTaskResultSummary({
        status: "completed",
        changes: [{ operation: "execute" }, { operation: "modify" }, { operation: "create" }],
      })
    ).toBe("已完成 3 项操作");
  });

  it("无 changes：completed → 已完成；failed / cancelled 不谎称完成", () => {
    expect(formatComputerTaskResultSummary({ status: "completed", changes: [] })).toBe("已完成");
    expect(formatComputerTaskResultSummary({ status: "failed", changes: [] })).toBe("操作未完成");
    expect(formatComputerTaskResultSummary({ status: "cancelled", changes: [] })).toBe("已停止");
    expect(formatComputerTaskResultSummary({ status: "undone", changes: [] })).toBe("已撤销");
  });

  it("失败但存在真实变更 → 仍按事实汇总（不隐藏已验证 changes）", () => {
    expect(
      formatComputerTaskResultSummary({ status: "failed", changes: [{ operation: "modify" }] })
    ).toBe("已完成 1 项文件更改");
  });

  it("summarizeComputerTaskResult 计数", () => {
    expect(
      summarizeComputerTaskResult({ changes: [{ operation: "execute" }, { operation: "delete" }] })
    ).toEqual({ fileChangeCount: 1, commandCount: 1, totalCount: 2 });
  });
});

describe("Approval ownership（taskId 精确匹配）", () => {
  it("按 owning Computer Task id 匹配 message；找不到 → null（orphan fallback）", () => {
    const messages = [
      { id: "m1" },
      { id: "m2", computerTask: { id: "task-2" } },
      { id: "m3", computerTask: { id: "task-3" } },
    ];
    expect(findApprovalOwnerMessageId(messages, "task-3")).toBe("m3");
    expect(findApprovalOwnerMessageId(messages, "task-unknown")).toBeNull();
    expect(findApprovalOwnerMessageId(messages, null)).toBeNull();
    expect(findApprovalOwnerMessageId(messages, undefined)).toBeNull();
  });
});

function guiRequest(overrides: Partial<ComputerApprovalRequest> = {}): ComputerApprovalRequest {
  return {
    id: "approval-1",
    toolCallId: "tool-call-1",
    taskId: "task-1",
    capability: "ui.interact",
    risk: "execute",
    workspaceId: "ws-1",
    workspaceLabel: "ClassFlow Desktop",
    resourceLabel: "发送",
    description: "Kiro 想操作电脑",
    allowedDecisions: ["deny", "allow-once"],
    gui: {
      action: "click",
      appName: "微信",
      windowTitle: "文件传输助手",
      targetLabel: "发送",
      riskLevel: "normal",
      riskReason: "普通点击",
      coordinateFallback: false,
    },
    ...overrides,
  };
}

describe("Approval Presentation（Inline / fallback Dialog 共用）", () => {
  it("GUI：标题 / 主行动 / app·window meta；normal 无 warning", () => {
    const p = getComputerApprovalPresentation(guiRequest());
    expect(p.title).toBe("Kiro 准备执行");
    expect(p.primary).toBe("在微信中点击「发送」");
    expect(p.meta).toEqual(["微信 · 文件传输助手"]);
    expect(p.warnings).toEqual([]);
    expect(p.highRisk).toBe(false);
  });

  it("GUI：risk / coordinateFallback → 产品化 warning（不显示 UIA 术语）", () => {
    const p = getComputerApprovalPresentation(
      guiRequest({
        gui: {
          action: "click",
          appName: "微信",
          windowTitle: "文件传输助手",
          targetLabel: "发送",
          riskLevel: "sensitive",
          riskReason: "可能发送敏感内容",
          coordinateFallback: true,
        },
      })
    );
    expect(p.warnings).toEqual([
      "可能发送敏感内容",
      "定位不确定：未能精确定位控件，批准前请目检目标是否正确",
      "敏感输入已隐藏，批准不会泄露原文",
    ]);
    expect(p.highRisk).toBe(true);
    expect(JSON.stringify(p)).not.toContain("UIA");
  });

  it("GUI：textPreview 保持有界展示（Main 已脱敏字段原样透传）", () => {
    const p = getComputerApprovalPresentation(
      guiRequest({
        gui: {
          action: "type",
          appName: "记事本",
          windowTitle: "无标题",
          targetLabel: "文本输入",
          textPreview: "hello",
          riskLevel: "normal",
          riskReason: "",
          coordinateFallback: false,
        },
      })
    );
    expect(p.primary).toBe("在记事本中输入文本「文本输入」");
    expect(p.textPreview).toBe("hello");
  });

  it("GUI 后台：warnings 必含不可见警告 + meta 标注；highRisk 分级不变", () => {
    const p = getComputerApprovalPresentation(guiRequest({ background: true }));
    expect(p.warnings).toContain("后台执行：窗口不会置顶，你看不到实时过程，请从执行记录确认结果");
    expect(p.meta).toContain("后台静默执行");
    expect(p.highRisk).toBe(false);
    expect(p.title).toBe("Kiro 准备执行");
  });

  it("Terminal：shell / 工作目录 / 命令默认可见；destructive → warning + highRisk", () => {
    const p = getComputerApprovalPresentation({
      id: "approval-2",
      toolCallId: "tool-call-2",
      taskId: "task-2",
      capability: "shell.execute",
      risk: "execute",
      workspaceId: "ws-1",
      workspaceLabel: "ClassFlow Desktop",
      resourceLabel: "npm test",
      description: "Kiro 想运行终端命令",
      allowedDecisions: ["deny", "allow-once"],
      commandPreview: "npm test",
      shell: "powershell",
      relativePath: "src",
      terminalRisk: "destructive",
    });
    expect(p.title).toBe("Kiro 准备运行命令");
    expect(p.primary).toBe("PowerShell");
    expect(p.meta).toEqual(["工作目录 /src", "ClassFlow Desktop"]);
    expect(p.command).toBe("npm test");
    expect(p.warnings).toEqual(["此命令可能删除或不可逆修改文件，操作不可撤销，批准前请确认命令内容。"]);
    expect(p.highRisk).toBe(true);
  });

  it("Terminal：normal 无 warning；cmd shell 文案正确", () => {
    const p = getComputerApprovalPresentation({
      id: "approval-3",
      toolCallId: "tool-call-3",
      taskId: "task-3",
      capability: "shell.execute",
      risk: "execute",
      workspaceId: "ws-1",
      workspaceLabel: "ClassFlow Desktop",
      resourceLabel: "dir",
      description: "Kiro 想运行终端命令",
      allowedDecisions: ["deny", "allow-once", "allow-session"],
      commandPreview: "dir",
      shell: "cmd",
      terminalRisk: "normal",
    });
    expect(p.primary).toBe("命令提示符");
    expect(p.meta[0]).toBe("工作目录 /");
    expect(p.warnings).toEqual([]);
    expect(p.highRisk).toBe(false);
  });

  it("File：修改 / 创建 / 删除语义 + workspace / root；删除 → highRisk", () => {
    const modify = getComputerApprovalPresentation({
      id: "approval-4",
      toolCallId: "tool-call-4",
      taskId: "task-4",
      capability: "document.modify",
      risk: "modify",
      workspaceId: "ws-1",
      workspaceLabel: "ClassFlow Desktop",
      rootId: "root-1",
      rootLabel: "项目文件",
      relativePath: "report.docx",
      resourceLabel: "report.docx",
      description: "Kiro 请求文件权限",
      allowedDecisions: ["deny", "allow-once", "allow-session", "allow-workspace"],
    });
    expect(modify.title).toBe("Kiro 准备修改");
    expect(modify.primary).toBe("report.docx");
    expect(modify.meta).toEqual(["ClassFlow Desktop / 项目文件", "修改操作"]);
    expect(modify.highRisk).toBe(false);

    const remove = getComputerApprovalPresentation({
      ...guiRequest(),
      capability: "fs.delete",
      risk: "destructive",
      gui: undefined,
      resourceLabel: "old.md",
    });
    expect(remove.title).toBe("Kiro 准备删除");
    expect(remove.highRisk).toBe(true);
    expect(isComputerApprovalHighRisk({ ...guiRequest(), capability: "fs.delete", risk: "destructive", gui: undefined })).toBe(true);
  });

  it("决策按钮文案齐全（Inline / Dialog 共用）", () => {
    expect(COMPUTER_APPROVAL_DECISION_LABELS).toEqual({
      deny: "拒绝",
      "allow-once": "允许这一次",
      "allow-session": "本次会话允许",
      "allow-workspace": "此 Workspace 始终允许",
    });
  });
});
