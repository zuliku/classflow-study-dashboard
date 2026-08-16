// @vitest-environment jsdom
/**
 * Visual Action Intake V1.5：Live Card UI —— Selective Apply / Source Strip / Badge。
 * - 默认全部 selected；deselect 后 Apply count 更新
 * - 0 selected → Apply disabled + 状态文案
 * - Pending 永远不可选择
 * - 全选/取消全选（≥3 行）
 * - 临时/永久 badge 确定性生成
 * - Source Strip：sourceAttachments → 缩略图 + 查看原图 → Preview Dialog
 * - 来源缺失 → 纯文本降级（不报错）
 * - applied 后：行级已应用/未应用标记；顶部 X 消失
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { VisualActionProposalCard } from "@/components/kiro/VisualActionProposalCard";
import { createVisualProposalRuntime } from "@/lib/ai/visual/receipt";
import { clearLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { VisualActionProposal } from "@/lib/ai/visual/types";

const mocks = vi.hoisted(() => {
  let version = 0;
  return {
    runtime: null as ReturnType<typeof createVisualProposalRuntime> | null,
    getVersion: () => version,
    bump: () => {
      version++;
    },
    executor: { executeVisualActionProposal: vi.fn() },
    toast: { pushToast: vi.fn() },
  };
});

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    handoffPrompt: vi.fn(),
    handoffVisualPendingContinuation: vi.fn(),
    visualProposalRuntime: mocks.runtime!,
    visualProposalVersion: mocks.getVersion(),
  }),
}));

vi.mock("@/store/useToastStore", () => ({
  useToastStore: (sel: (s: { pushToast: unknown }) => unknown) => sel({ pushToast: mocks.toast.pushToast }),
}));

vi.mock("@/lib/ai/visual/executor", () => ({
  executeVisualActionProposal: (args: { proposal: VisualActionProposal }) =>
    mocks.executor.executeVisualActionProposal(args),
}));

vi.mock("@/lib/ai/visual/continuation", () => ({
  buildVisualPendingContinuation: () => undefined,
}));

function makeProposal(over: Partial<VisualActionProposal> = {}): VisualActionProposal {
  return {
    id: "p-live-1",
    sourceAttachmentIds: ["img-1", "img-2"],
    summary: "从截图整理出 3 项",
    actions: [
      {
        id: "pa-1",
        change: { tool: "create_assignment", input: { title: "作业" } } as never,
        evidence: { text: "图中显示 8 月 20 日截止" },
        display: { kind: "assignment-create", title: "数据结构实验报告" },
      },
      {
        id: "pa-2",
        change: { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T23:59:00" } } as never,
        evidence: { text: "图中显示 14:00" },
        display: { kind: "ddl-update", title: "调整截止时间" },
      },
      {
        id: "pa-3",
        change: { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 3, dayOfWeek: 6, startTime: "14:00", endTime: "15:40" } } as never,
        evidence: { text: "调到周六" },
        display: { kind: "schedule-move", title: "计算机网络", subtitle: "第 3 周 · 周三 14:00 → 周六 14:00" },
      },
    ],
    pendingItems: [
      { id: "vp-1", reason: "ambiguous-entity", evidence: { text: "王老师那门课改期" }, description: "无法唯一确定对应课程" },
    ],
    createdAt: 123,
    reservedIds: [],
    ...over,
  };
}

function renderCard(proposal?: VisualActionProposal, sourceAttachments?: ReturnType<typeof import("@/lib/ai/attachments/liveImageRegistry").resolveLiveImageSources>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => {
    act(() => {
      root.render(
        <VisualActionProposalCard
          proposal={proposal ?? makeProposal()}
          sourceAttachments={sourceAttachments}
        />
      );
    });
  };
  render();
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, text: () => container.textContent ?? "", render, cleanup };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime = createVisualProposalRuntime();
  clearLiveImageSources();
  // jsdom 无 object URL；Preview Dialog 测试需要（create → 打开，revoke → 关闭）
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => "blob:mock-v15"),
    revokeObjectURL: vi.fn(),
  });
});

describe("VisualActionProposalCard V1.5：Selective Apply（UI-only selection）", () => {
  it("默认全部 selected；Apply 文案「应用全部修改」", () => {
    const { container, cleanup } = renderCard();
    expect(container.querySelectorAll('[data-testid="visual-action-select"]')).toHaveLength(3);
    expect((container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).textContent).toContain("应用全部修改");
    cleanup();
  });

  it("deselect 一项 → Apply count 更新（应用 2 项修改）", () => {
    const { container, cleanup } = renderCard();
    const selects = Array.from(container.querySelectorAll('[data-testid="visual-action-select"]')) as HTMLButtonElement[];
    act(() => {
      selects[2].click(); // 取消第 3 项
    });
    expect((container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).textContent).toContain("应用 2 项修改");
    // 传出的 selectedActionIds 只含前两项（original order）
    mocks.executor.executeVisualActionProposal.mockResolvedValue({ ok: true, count: 2, appliedActionIndexes: [0, 1], undo: () => {} });
    act(() => {
      (container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).click();
    });
    const args = mocks.executor.executeVisualActionProposal.mock.calls[0][0] as { selectedActionIds: string[] };
    expect(args.selectedActionIds).toEqual(["pa-1", "pa-2"]);
    cleanup();
  });

  it("0 selected → Apply disabled + 状态「请选择至少一项要应用的修改」", () => {
    const { container, cleanup } = renderCard();
    const selects = Array.from(container.querySelectorAll('[data-testid="visual-action-select"]')) as HTMLButtonElement[];
    act(() => {
      selects.forEach((b) => b.click());
    });
    const apply = container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(container.textContent).toContain("请选择至少一项要应用的修改");
    cleanup();
  });

  it("≥3 行显示全选；取消全选后 Apply disabled；再全选恢复", () => {
    const { container, cleanup } = renderCard();
    const selectAll = container.querySelector('[data-testid="visual-select-all"]') as HTMLButtonElement;
    expect(selectAll).toBeTruthy();
    act(() => {
      selectAll.click();
    });
    expect((container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("请选择至少一项要应用的修改");
    act(() => {
      selectAll.click();
    });
    expect((container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
  });

  it("1–2 行不显示全选控制", () => {
    const { container, cleanup } = renderCard(makeProposal({ actions: makeProposal().actions.slice(0, 2) }));
    expect(container.querySelector('[data-testid="visual-select-all"]')).toBeNull();
    cleanup();
  });

  it("Pending 永远不可选择（无 checkbox；继续处理按钮保留）", () => {
    const { container, cleanup } = renderCard();
    expect(container.textContent).toContain("需要确认 · 1");
    // pending 行没有 checkbox
    const pendingRows = container.querySelectorAll('[data-testid="visual-action-select"]');
    expect(pendingRows).toHaveLength(3); // 只有 3 个 executable 行有 checkbox
    // Apply count 只算 executable（选择 2 项 → 应用 2 项，不含 pending）
    const selects = Array.from(container.querySelectorAll('[data-testid="visual-action-select"]')) as HTMLButtonElement[];
    act(() => {
      selects[2].click();
    });
    expect((container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).textContent).toContain("应用 2 项修改");
    cleanup();
  });

  it("applied（subset）→ 行级已应用/未应用 + 状态「已应用 2 项修改 · 1 项未选择 · 1 项仍待确认」；顶部 X 消失", async () => {
    mocks.executor.executeVisualActionProposal.mockResolvedValue({
      ok: true,
      count: 2,
      appliedActionIndexes: [0, 1],
      undo: () => {},
    });
    const card = renderCard();
    const selects = Array.from(card.container.querySelectorAll('[data-testid="visual-action-select"]')) as HTMLButtonElement[];
    act(() => {
      selects[2].click(); // 不选第 3 项
    });
    await act(async () => {
      (card.container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    mocks.bump();
    card.render();
    expect(card.text()).toContain("已应用 2 项修改");
    expect(card.text()).toContain("1 项未选择");
    expect(card.text()).toContain("1 项仍待确认");
    const rowStates = Array.from(card.container.querySelectorAll('[data-testid="visual-row-applied"]')) as HTMLSpanElement[];
    expect(rowStates).toHaveLength(3);
    expect(rowStates[0].textContent).toBe("已应用");
    expect(rowStates[2].textContent).toBe("未应用");
    // applied 后顶部 X 消失（不能误读为取消执行）
    const closeButtons = Array.from(card.container.querySelectorAll("button[aria-label='关闭']"));
    expect(closeButtons).toHaveLength(0);
    // checkbox 不再出现
    expect(card.container.querySelectorAll('[data-testid="visual-action-select"]')).toHaveLength(0);
    card.cleanup();
  });
});

describe("VisualActionProposalCard V1.5：Header / Source Strip / Badge", () => {
  it("主身份「操作预览」+ 来源数量副行（从 2 张截图整理出 4 项）", () => {
    const { text, cleanup } = renderCard();
    expect(text()).toContain("操作预览");
    expect(text()).toContain("从 2 张截图整理出 4 项");
    expect(text()).toContain("3 项可应用 · 1 项待确认");
    cleanup();
  });

  it("Source Strip：live 来源缩略图 + 查看原图 → 打开 Preview Dialog；Esc 关闭", () => {
    const file1 = new File([new Uint8Array([1])], "1.png", { type: "image/png" });
    const file2 = new File([new Uint8Array([2])], "2.png", { type: "image/png" });
    const sources = [
      { id: "img-1", file: file1, name: "1.png", thumbnail: "data:image/png;base64,AAA" },
      { id: "img-2", file: file2, name: "2.png", thumbnail: "data:image/png;base64,BBB" },
    ];
    const { container, cleanup } = renderCard(makeProposal(), sources as never);
    expect(container.querySelectorAll('[data-testid="visual-source-thumb"]')).toHaveLength(2);
    expect(container.textContent).toContain("查看原图");
    // 点击缩略图 → Preview Dialog（Portal 到 document.body；img src = object URL）
    act(() => {
      (container.querySelector('[data-testid="visual-source-thumb"]') as HTMLButtonElement).click();
    });
    const preview = document.body.querySelector('[data-testid="kiro-image-preview"]');
    expect(preview).toBeTruthy();
    expect(preview!.querySelector("img")).toBeTruthy();
    // Esc 关闭
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.querySelector('[data-testid="kiro-image-preview"]')).toBeNull();
    cleanup();
  });

  it("来源缺失（历史恢复 / 无 live File）→ 纯文本降级「来源 · 2 张图片」；不渲染缩略图；不报错", () => {
    const { text, container, cleanup } = renderCard();
    expect(text()).toContain("来源");
    expect(text()).toContain("· 2 张图片");
    expect(container.querySelectorAll('[data-testid="visual-source-thumb"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="visual-source-open"]')).toBeNull();
    cleanup();
  });

  it("临时/永久 badge 由 kind + week 确定性生成（无模型文案输入）", () => {
    const proposal = makeProposal();
    const { text, cleanup } = renderCard(proposal);
    expect(text()).toContain("仅第 3 周");
    cleanup();
  });

  it("permanent kind → 「永久」badge；assignment 无 badge", () => {
    const base = makeProposal();
    const proposal = {
      ...base,
      actions: [
        {
          id: "pa-p",
          change: { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 5, startTime: "16:00" } } as never,
          evidence: { text: "以后都改到周五" },
          display: { kind: "schedule-permanent-update", title: "数据结构与算法", subtitle: "永久调整排课 · 周三 10:00 → 周五 16:00" },
        },
        base.actions[0],
      ],
    } as never;
    const { text, cleanup } = renderCard(proposal);
    expect(text()).toContain("永久");
    expect(text()).not.toContain("仅第");
    cleanup();
  });

  it("Evidence 展开默认折叠；展开后显示原文（无坐标高亮/框选）", () => {
    const { container, text, cleanup } = renderCard();
    expect(text()).not.toContain("图中显示 8 月 20 日截止");
    const toggle = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("依据"));
    act(() => {
      toggle!.click();
    });
    expect(text()).toContain("图中显示 8 月 20 日截止");
    cleanup();
  });
});
