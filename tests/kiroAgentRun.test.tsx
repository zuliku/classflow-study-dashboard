// @vitest-environment jsdom
/**
 * Kiro Agent Run + Inline Approval（P4）— 组件 / 接线测试。
 *
 * 覆盖：Agent Run 显示条件、Header 状态（running / composing / paused / waiting / completed /
 * failed / cancelled + 真实 duration）、disclosure 语义（live expanded / history collapsed /
 * 完成不强制折叠）、Inline Approval（只渲染 allowedDecisions / busy 生命周期 / request.id 变更
 * 恢复可交互 / 折叠 Timeline 仍可见）、Result 去重复化（running 不显示 / 泛化摘要 / Undo 语义）、
 * 停止入口、以及「渲染 DOM 不含内部 id」的安全断言。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroMessage } from "@/components/kiro/KiroMessage";
import type { KiroAssistantTurnPresentation, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import type { KiroAgentTask, KiroComputerChange } from "@/lib/ai/computer/task";
import type { ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import type { PersistedComputerTaskView } from "@/lib/ai/history/types";

vi.mock("@/hooks/useKiroArtifactActions", () => ({
  useKiroArtifactActions: () => ({
    previewArtifact: vi.fn(),
    downloadArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
    askKiroArtifact: vi.fn(),
  }),
}));

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector) as HTMLElement | null;
}

async function render(node: React.ReactElement) {
  await act(async () => {
    root!.render(node);
  });
}

function toolBlock(overrides: Partial<Extract<KiroWorklogBlock, { kind: "tool" }>> = {}) {
  return {
    kind: "tool" as const,
    id: "tool-tc-1",
    toolCallId: "tc-1",
    toolName: "list_directory",
    label: "浏览工作区",
    headline: "已查看工作区",
    status: "done" as const,
    toolKind: "read" as const,
    safeDetails: [],
    stepIndex: 1,
    ...overrides,
  };
}

function turn(overrides: Partial<KiroAssistantTurnPresentation> = {}): KiroAssistantTurnPresentation {
  return {
    worklog: [toolBlock()],
    answer: "",
    answerStreaming: false,
    hasTools: true,
    worklogDone: false,
    phase: "working",
    ...overrides,
  };
}

function change(overrides: Partial<KiroComputerChange> = {}): KiroComputerChange {
  return {
    id: "change-1",
    toolCallId: "tc-1",
    operation: "modify",
    resourceType: "document",
    workspaceId: "ws-1",
    workspaceLabel: "ClassFlow Desktop",
    rootId: "root-1",
    rootLabel: "项目文件",
    relativePath: "report.docx",
    displayName: "report.docx",
    revision: 2,
    verification: "passed",
    review: { kind: "relocation" },
    ...overrides,
  };
}

function task(overrides: Partial<KiroAgentTask> = {}): KiroAgentTask {
  return {
    id: "task-1",
    conversationId: null,
    userMessageId: "u1",
    title: "工作区文件操作",
    status: "completed",
    steps: [],
    changes: [change()],
    toolCallIds: ["tc-1"],
    canUndo: true,
    undoUsed: false,
    startedAt: "2026-09-23T10:00:00.000Z",
    completedAt: "2026-09-23T10:01:42.000Z",
    ...overrides,
  };
}

function approval(overrides: Partial<ComputerApprovalRequest> = {}): ComputerApprovalRequest {
  return {
    id: "approval-1",
    toolCallId: "tc-1",
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

function messageNode(props: Record<string, unknown> = {}) {
  return (
    <KiroMessage
      messageId="m-1"
      assistantTurn={turn()}
      turnInFlight={true}
      {...props}
    />
  );
}

describe("Agent Run 显示条件与 Header", () => {
  it("普通无 Tool / 无 reasoningSummary assistant → 不显示 Agent Run", async () => {
    await render(
      <KiroMessage
        messageId="m-1"
        assistantTurn={turn({ worklog: [], hasTools: false, phase: "done" })}
      />
    );
    expect(q('[data-testid="kiro-agent-run"]')).toBeNull();
    expect(q('[data-testid="kiro-agent-run-header"]')).toBeNull();
  });

  it("同实例从无 worklog → live worklog（hooks 数量稳定，不崩溃）", async () => {
    await render(
      <KiroMessage
        messageId="m-1"
        assistantTurn={turn({ worklog: [], hasTools: false, phase: "working" })}
        turnInFlight
      />
    );
    expect(q('[data-testid="kiro-agent-run"]')).toBeNull();
    await render(<KiroMessage messageId="m-1" assistantTurn={turn()} turnInFlight />);
    expect(q('[data-testid="kiro-agent-run"]')).toBeTruthy();
  });

  it("存在 tool → 显示 Agent Run；live working → 正在执行", async () => {
    await render(messageNode());
    expect(q('[data-testid="kiro-agent-run"]')).toBeTruthy();
    const header = q('[data-testid="kiro-agent-run-header"]')!;
    expect(header.getAttribute("data-status")).toBe("running");
    expect(header.textContent).toContain("正在执行");
  });

  it("working Tool → Header 显示当前具体动作", async () => {
    await render(
      messageNode({
        assistantTurn: turn({
          worklog: [toolBlock({ status: "working", label: "搜索网络" })],
        }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("正在搜索网络");
  });

  it("reasoning-only live → Header 显示「正在思考」而不是通用占位", async () => {
    await render(
      messageNode({
        assistantTurn: turn({
          worklog: [],
          reasoningSummary: "正在思考",
          phase: "working",
        }),
      })
    );
    const header = q('[data-testid="kiro-agent-run-header"]');
    expect(header).toBeTruthy();
    expect(header!.textContent).toContain("正在思考");
  });

  it("composing → 正在整理回答", async () => {
    await render(messageNode({ assistantTurn: turn({ phase: "composing" }) }));
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("正在整理回答");
  });

  it("answering（Final Answer 已开始）→ 正在回答", async () => {
    await render(
      messageNode({
        assistantTurn: turn({ phase: "answering", answer: "答案开始", answerStreaming: true }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("正在回答");
  });

  it("settled done 且无 Task 时间戳 → 已完成（绝不伪造用时）", async () => {
    await render(messageNode({ assistantTurn: turn({ phase: "done" }), turnInFlight: false }));
    const header = q('[data-testid="kiro-agent-run-header"]')!;
    expect(header.getAttribute("data-status")).toBe("completed");
    expect(header.textContent).toContain("已完成");
    expect(header.textContent).not.toContain("用时");
  });

  it("completed + 真实 Task startedAt/completedAt → 用时 1m 42s", async () => {
    await render(
      messageNode({ assistantTurn: turn({ phase: "done" }), turnInFlight: false, computerTask: task() })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("用时 1m 42s");
  });

  it("task failed / cancelled（settled）→ 操作未完成 / 已停止", async () => {
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({ status: "failed" }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("操作未完成");

    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({ status: "cancelled" }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("已停止");
  });

  it("Desktop Session paused（in-flight）→ 已暂停", async () => {
    await render(messageNode({ desktopPaused: true }));
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("已暂停");
  });

  it("GUI 工具 working → 正在操作电脑", async () => {
    await render(
      messageNode({
        assistantTurn: turn({
          worklog: [toolBlock({ toolName: "desktop_action", label: "操作电脑", status: "working" })],
        }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("正在操作电脑");
  });

  it("running/waiting-approval 时显示停止入口；点击触发 canonical Stop（等待确认时为拒绝并停止）", async () => {
    const onStop = vi.fn();
    await render(messageNode({ onStop }));
    const stop = q('[data-testid="kiro-agent-run-stop"]');
    expect(stop).toBeTruthy();
    await act(async () => {
      stop!.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);

    await render(
      messageNode({
        onStop,
        approval: { request: approval(), queueLength: 1, onDecision: vi.fn() },
      })
    );
    const stopWaiting = q('[data-testid="kiro-agent-run-stop"]');
    expect(stopWaiting).toBeTruthy();
    expect(stopWaiting!.textContent).toContain("拒绝并停止");
  });
});

describe("Disclosure 语义", () => {
  it("live working → 默认展开（Timeline 可见）", async () => {
    await render(messageNode());
    expect(q('[data-testid="kiro-tool-row"]')).toBeTruthy();
  });

  it("回答 lane 开始 → 自动收起 Worklog（focus）", async () => {
    await render(messageNode());
    expect(q('[data-testid="kiro-tool-row"]')).toBeTruthy();
    await render(
      messageNode({ assistantTurn: turn({ phase: "answering", answer: "开始回答", answerStreaming: true }) })
    );
    const toggle = q('[data-testid="kiro-agent-run-header"] button')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
    expect(q('[data-testid="kiro-tool-row"]')).toBeNull();
  });

  it("用户手动展开优先 → 回答 lane 不强制收起", async () => {
    await render(messageNode());
    const firstToggle = q('[data-testid="kiro-agent-run-header"] button')!;
    // 手动折叠再展开 → userToggledRef 生效
    await act(async () => {
      firstToggle.click();
    });
    await act(async () => {
      q('[data-testid="kiro-agent-run-header"] button')!.click();
    });
    await render(
      messageNode({ assistantTurn: turn({ phase: "answering", answer: "开始回答", answerStreaming: true }) })
    );
    const toggle = q('[data-testid="kiro-agent-run-header"] button')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(q('[data-testid="kiro-tool-row"]')).toBeTruthy();
  });

  it("历史恢复 done → 默认折叠（Timeline 未挂载）", async () => {
    await render(messageNode({ assistantTurn: turn({ phase: "done" }), turnInFlight: false }));
    expect(q('[data-testid="kiro-agent-run-header"]')).toBeTruthy();
    expect(q('[data-testid="kiro-tool-row"]')).toBeNull();
  });

  it("完成瞬间不强制折叠（无 layout jump）", async () => {
    await render(messageNode());
    expect(q('[data-testid="kiro-tool-row"]')).toBeTruthy();
    await render(messageNode({ assistantTurn: turn({ phase: "done" }), turnInFlight: false }));
    expect(q('[data-testid="kiro-tool-row"]')).toBeTruthy();
  });

  it("用户手动折叠后，待确认 Approval 仍可见（Approval 不在 Disclosure 内）", async () => {
    const onDecision = vi.fn();
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        approval: { request: approval(), queueLength: 1, onDecision },
      })
    );
    // 历史 done 默认折叠 → Timeline 未挂载，但 Inline Approval 必须在
    expect(q('[data-testid="kiro-tool-row"]')).toBeNull();
    expect(q('[data-testid="kiro-inline-approval"]')).toBeTruthy();
    expect(q('[data-testid="kiro-agent-run-header"]')!.textContent).toContain("等待你的确认");
  });
});

describe("Inline Approval", () => {
  it("只渲染 allowedDecisions；不出现未授权的持久决策", async () => {
    await render(
      messageNode({
        approval: { request: approval(), queueLength: 1, onDecision: vi.fn() },
      })
    );
    expect(q('[data-testid="kiro-inline-approval"]')).toBeTruthy();
    expect(q('[data-testid="approval-deny"]')).toBeTruthy();
    expect(q('[data-testid="approval-allow-once"]')).toBeTruthy();
    expect(q('[data-testid="approval-allow-session"]')).toBeNull();
    expect(q('[data-testid="approval-allow-workspace"]')).toBeNull();
  });

  it("高风险（deny / allow-once）只显示这两个决策", async () => {
    await render(
      messageNode({
        approval: {
          request: approval({
            capability: "fs.delete",
            risk: "destructive",
            gui: undefined,
            allowedDecisions: ["deny", "allow-once"],
          }),
          queueLength: 1,
          onDecision: vi.fn(),
        },
      })
    );
    const buttons = container!.querySelectorAll('[data-testid^="approval-"]');
    expect(Array.from(buttons).map((b) => b.getAttribute("data-testid"))).toEqual([
      "approval-deny",
      "approval-allow-once",
    ]);
  });

  it("点击一次 → onDecision(id, decision) + buttons disabled；重复点击不再触发", async () => {
    const onDecision = vi.fn();
    await render(
      messageNode({ approval: { request: approval(), queueLength: 1, onDecision } })
    );
    const allow = q('[data-testid="approval-allow-once"]') as HTMLButtonElement;
    await act(async () => {
      allow.click();
    });
    expect(onDecision).toHaveBeenCalledWith("approval-1", "allow-once");
    expect((q('[data-testid="approval-allow-once"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[data-testid="approval-deny"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      allow.click();
    });
    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it("request.id 改变（队列下一条）→ busy reset，恢复可交互", async () => {
    const onDecision = vi.fn();
    await render(
      messageNode({ approval: { request: approval(), queueLength: 2, onDecision } })
    );
    await act(async () => {
      (q('[data-testid="approval-deny"]') as HTMLButtonElement).click();
    });
    expect((q('[data-testid="approval-deny"]') as HTMLButtonElement).disabled).toBe(true);

    await render(
      messageNode({
        approval: {
          request: approval({ id: "approval-2", taskId: "task-1" }),
          queueLength: 1,
          onDecision,
        },
      })
    );
    expect((q('[data-testid="approval-deny"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("队列剩余项以「还有 N 项等待确认」表达（不做批量允许 UI）", async () => {
    await render(
      messageNode({ approval: { request: approval(), queueLength: 3, onDecision: vi.fn() } })
    );
    expect(q('[data-testid="kiro-inline-approval"]')!.textContent).toContain("还有 2 项等待确认");
    expect(q('[data-testid="kiro-inline-approval"]')!.textContent).not.toContain("批量允许");
  });

  it("Approval resolve（request 消失）→ Inline UI 折叠退出后卸载", async () => {
    await render(messageNode({ approval: { request: approval(), queueLength: 1, onDecision: vi.fn() } }));
    expect(q('[data-testid="kiro-inline-approval"]')).toBeTruthy();
    await render(messageNode({ approval: null }));
    // 退出期仍挂载（折叠中），随后才卸载（此前瞬时卸载顶起下方内容）
    expect(q('[data-testid="kiro-inline-approval"]')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(q('[data-testid="kiro-inline-approval"]')).toBeNull();
  });

  it("渲染 DOM 不含内部标识（taskId / toolCallId / approval id / elementId / HWND / PID）", async () => {
    await render(
      messageNode({
        approval: {
          request: approval({
            gui: {
              action: "click",
              appName: "微信",
              windowTitle: "文件传输助手",
              targetLabel: "发送",
              riskLevel: "normal",
              riskReason: "普通点击",
              coordinateFallback: false,
            },
          }),
          queueLength: 1,
          onDecision: vi.fn(),
        },
      })
    );
    const html = container!.innerHTML;
    for (const forbidden of [
      "task-1",
      "tc-1",
      "approval-1",
      "elementId",
      "observationId",
      "HWND",
      "PID",
      "nativePath",
      "absolutePath",
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});

describe("DOM 结构：execution → Final Answer → Result", () => {
  it("Agent Run（Header/Timeline/Approval）在 Final Answer 之前；Result 在 Final Answer 之后", async () => {
    await render(
      messageNode({
        content: "文件已经发送完成。",
        assistantTurn: turn({ phase: "answering", answer: "文件已经发送完成。" }),
        approval: { request: approval(), queueLength: 1, onDecision: vi.fn() },
        computerTask: task(),
      })
    );
    const run = q('[data-testid="kiro-agent-run"]')!;
    const inline = q('[data-testid="kiro-inline-approval"]')!;
    const result = q('[data-testid="kiro-agent-run-result"]')!;
    const answer = Array.from(container!.querySelectorAll("p, div")).find((el) =>
      el.textContent === "文件已经发送完成。"
    ) as HTMLElement;

    expect(answer).toBeTruthy();
    // run → approval → answer → result（execution 与 Final Answer 是不同 lane）
    expect(run.compareDocumentPosition(inline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inline.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Agent Run Result（去重复化）", () => {
  it("running task → 不显示 Result（由 Header / Timeline / Approval 表达）", async () => {
    await render(
      messageNode({ computerTask: task({ status: "running", completedAt: undefined }) })
    );
    expect(q('[data-testid="kiro-agent-run-result"]')).toBeNull();
  });

  it("awaiting_permission → 不显示 Result；running steps 不再重复展示", async () => {
    await render(
      messageNode({
        computerTask: task({
          status: "awaiting_permission",
          completedAt: undefined,
          steps: [
            {
              id: "step-1",
              toolCallId: "tc-1",
              label: "正在操作电脑",
              status: "awaiting_permission",
              startedAt: "2026-09-23T10:00:00.000Z",
            },
          ],
        }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-result"]')).toBeNull();
    expect(container!.textContent).not.toContain("正在操作电脑");
  });

  it("completed → 泛化摘要 + [查看更改] [撤销]（canUndo）", async () => {
    const onReview = vi.fn();
    const onUndo = vi.fn();
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({ changes: [change(), change({ id: "change-2", displayName: "summary.md", relativePath: "summary.md", operation: "create", revision: undefined })] }),
        onReviewComputerTask: onReview,
        onUndoComputerTask: onUndo,
      })
    );
    const result = q('[data-testid="kiro-agent-run-result"]')!;
    expect(result.textContent).toContain("已完成 2 项文件更改");
    expect(result.textContent).toContain("修改 report.docx · v2");
    expect(result.textContent).toContain("创建 summary.md");
    await act(async () => {
      q('[data-testid="kiro-task-review"]')!.click();
    });
    expect(onReview).toHaveBeenCalledWith("task-1");
    await act(async () => {
      q('[data-testid="kiro-task-undo"]')!.click();
    });
    expect(onUndo).toHaveBeenCalledWith("task-1");
  });

  it("terminal-only task → 「已运行 1 个命令」，绝不写「文件更改」", async () => {
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({
          changes: [
            change({
              operation: "execute",
              resourceType: "terminal",
              displayName: "pnpm test",
              relativePath: "pnpm test",
              revision: undefined,
            }),
          ],
        }),
      })
    );
    const result = q('[data-testid="kiro-agent-run-result"]')!;
    expect(result.textContent).toContain("已运行 1 个命令");
    expect(result.textContent).not.toContain("文件更改");
  });

  it("undoUsed → 撤销按钮消失；undone → 已撤销本次更改", async () => {
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({ undoUsed: true }),
      })
    );
    expect(q('[data-testid="kiro-task-undo"]')).toBeNull();
    expect(q('[data-testid="kiro-task-review"]')).toBeTruthy();

    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        computerTask: task({ status: "undone", canUndo: false, undoUsed: true }),
      })
    );
    expect(q('[data-testid="kiro-agent-run-result"]')!.textContent).toContain("已撤销本次更改");
    expect(q('[data-testid="kiro-task-undo"]')).toBeNull();
  });

  it("历史恢复 task → display-only（有事实与历史记录标注，无 Undo / Review）", async () => {
    const historyTask: PersistedComputerTaskView = {
      taskId: "task-old",
      title: "工作区文件操作",
      status: "completed",
      changes: [
        {
          operation: "modify",
          resourceType: "document",
          displayName: "report.docx",
          workspaceLabel: "ClassFlow Desktop",
          rootLabel: "项目文件",
          relativePath: "report.docx",
          revision: 2,
          verification: "passed",
        },
      ],
      startedAt: "2026-09-20T10:00:00.000Z",
      completedAt: "2026-09-20T10:00:42.000Z",
    };
    await render(
      messageNode({
        assistantTurn: turn({ phase: "done" }),
        turnInFlight: false,
        historyComputerTask: historyTask,
      })
    );
    const result = q('[data-testid="kiro-agent-run-result"]')!;
    expect(result.getAttribute("data-state")).toBe("history");
    expect(result.textContent).toContain("已完成 1 项文件更改");
    expect(result.textContent).toContain("历史记录");
    expect(q('[data-testid="kiro-task-undo"]')).toBeNull();
    expect(q('[data-testid="kiro-task-review"]')).toBeNull();
  });
});
