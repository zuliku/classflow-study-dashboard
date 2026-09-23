// @vitest-environment jsdom
/**
 * Kiro Composer P3 — 四入口 / Add Menu / Access / Model 交互测试。
 *
 * 一级只允许：＋（Add）· 访问（Access）· 模型（Model · Reasoning）· 发送（Send）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { useAppStore } from "@/store/useAppStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import type { ReasoningCapability } from "@/lib/ai/reasoning/types";
import type { KiroAgentMode } from "@/lib/ai/computer/types";

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

const ADJUSTABLE: ReasoningCapability = {
  adjustable: true,
  supportedEfforts: ["default", "medium", "high"],
  mechanism: "effort",
};
const FIXED: ReasoningCapability = { adjustable: false, supportedEfforts: ["default"], mechanism: "fixed" };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const handlers = {
  onSend: vi.fn(async () => true),
  onStop: vi.fn(),
  onSelectModel: vi.fn(),
  onSetReasoningEffort: vi.fn(),
  onToggleComputer: vi.fn(),
  onSetAgentMode: vi.fn(),
  onAddFiles: vi.fn(),
  onAddMaterial: vi.fn(),
  onAddContext: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenAgentSettings: vi.fn(),
  onRemoveContext: vi.fn(),
};

function composerProps(overrides: Record<string, unknown> = {}) {
  return {
    contexts: [],
    onAddContext: handlers.onAddContext,
    onRemoveContext: handlers.onRemoveContext,
    onSend: handlers.onSend,
    streaming: false,
    turnInFlight: false,
    runtimeStatus: "ready" as const,
    onStop: handlers.onStop,
    configured: true,
    modelOptions: [
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", vendor: null },
      { value: "claude-x", label: "Claude X", vendor: null },
    ],
    activeModelName: "GPT-5.6 Sol",
    selectedModelId: "gpt-5.6-sol",
    activeModelVendor: null,
    onSelectModel: handlers.onSelectModel,
    onOpenSettings: handlers.onOpenSettings,
    attachments: [],
    hasProcessing: false,
    visionEnabled: true,
    onAddFiles: handlers.onAddFiles,
    onRemoveAttachment: vi.fn(),
    onRetryAttachment: vi.fn(),
    onSaveAttachmentToCourse: vi.fn(),
    onAddMaterial: handlers.onAddMaterial,
    computerEnabled: true,
    onToggleComputer: handlers.onToggleComputer,
    agentMode: "guided" as KiroAgentMode,
    onSetAgentMode: handlers.onSetAgentMode,
    reasoningCapability: ADJUSTABLE,
    reasoningEffort: "high" as const,
    onSetReasoningEffort: handlers.onSetReasoningEffort,
    workspace: {
      id: "ws-1",
      name: "ClassFlow Desktop",
      roots: [{ id: "root-1", label: "资料", access: "read-write", adapterRef: "sandbox-default" }],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    workspaceIsSandbox: true,
    grantWarning: null,
    permissionSummary: { terminal: true, desktopObserve: true, desktopAction: true, clipboard: false },
    onOpenAgentSettings: handlers.onOpenAgentSettings,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderComposer(overrides: Record<string, unknown> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<KiroComposer {...(composerProps(overrides) as never)} />);
  });
  await flush();
}

function rerenderComposer(overrides: Record<string, unknown> = {}) {
  act(() => {
    root!.render(<KiroComposer {...(composerProps(overrides) as never)} />);
  });
}

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector);
}

async function click(selector: string) {
  const el = q(selector);
  expect(el, selector).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

async function clickText(text: string) {
  const el = Array.from(container!.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text)
  ) as HTMLElement | undefined;
  expect(el, `button text=${text}`).toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
}

function text(): string {
  return container?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  useKiroPreferencesStore.setState({ webSearchEnabled: false });
  useAppStore.setState({
    courses: [
      {
        id: "c1",
        name: "中级计量经济学",
        teacher: "王老师",
        materials: [{ id: "m1", title: "第三章讲义", type: "pdf" }],
      },
    ] as never,
    assignments: [] as never,
    groupProjects: [] as never,
  });
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Kiro Composer P3 — 一级四入口", () => {
  it("一级：＋ / 访问 / 思考程度（模型左侧）/ 模型 / 发送", async () => {
    await renderComposer();
    const add = q('[data-testid="kiro-composer-add"]')!;
    const access = q('[data-testid="kiro-composer-access"]')!;
    const reasoning = q('[data-testid="kiro-composer-reasoning"]')!;
    const model = q('[data-testid="kiro-composer-model"]')!;
    const send = container!.querySelector('[aria-label="发送"]')!;
    expect(add && access && reasoning && model && send).toBeTruthy();
    // Reasoning 位于 Model 左侧（DOM 顺序）
    expect(reasoning.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 无独立 @ / Web / CPU / AgentMode / 思考程度一级图标按钮
    expect(q('[aria-label="选择上下文"]')).toBeNull();
    expect(q('[aria-label="联网搜索"]')).toBeNull();
    expect(q('[aria-label="Computer"]')).toBeNull();
    expect(q('[aria-label="权限模式"]')).toBeNull();
  });

  it("Workspace chip 已从 Context Bar 移除（迁入 Access）", async () => {
    await renderComposer();
    expect(q('[aria-label="工作区"]')).toBeNull();
  });
});

describe("Kiro Composer P3 — Add Menu（内容与来源）", () => {
  it("包含 上传文件 / 添加图片 / 课程资料 / ClassFlow 上下文 + 联网搜索状态", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    const menu = q('[data-testid="kiro-composer-add-menu"]')!;
    expect(menu.textContent).toContain("上传文件");
    expect(menu.textContent).toContain("添加图片");
    expect(menu.textContent).toContain("课程资料");
    expect(menu.textContent).toContain("ClassFlow 上下文");
    const webToggle = q('[data-testid="kiro-composer-web-search"]')!;
    expect(webToggle.textContent).toContain("联网搜索");
    expect(webToggle.textContent).toContain("关闭");
    expect(webToggle.getAttribute("aria-checked")).toBe("false");
  });

  it("联网搜索开关 → 修改下一 Turn preference（不依赖 Computer）", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    await click('[data-testid="kiro-composer-web-search"]');
    expect(useKiroPreferencesStore.getState().webSearchEnabled).toBe(true);
  });

  it("Turn 运行中：scope 条目禁用，联网搜索仍可切换（intent 冻结后）", async () => {
    await renderComposer({ turnInFlight: true, turnIntentFrozen: true });
    await click('[data-testid="kiro-composer-add"]');
    const fileButton = Array.from(container!.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("上传文件")
    ) as HTMLButtonElement;
    expect(fileButton.disabled).toBe(true);
    const webToggle = q('[data-testid="kiro-composer-web-search"]') as HTMLButtonElement;
    expect(webToggle.disabled).toBe(false);
    await act(async () => webToggle.click());
    expect(useKiroPreferencesStore.getState().webSearchEnabled).toBe(true);
  });

  it("preparing 且 intent 未冻结：联网搜索禁用（preferences locked）", async () => {
    await renderComposer({ turnInFlight: true, preparingSend: true, turnIntentFrozen: false });
    await click('[data-testid="kiro-composer-add"]');
    expect((q('[data-testid="kiro-composer-web-search"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("课程资料 → 内部 view（不叠加 Popover）；ClassFlow 上下文 → 共享列表", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    await clickText("课程资料");
    expect(text()).toContain("第三章讲义");
    await clickText("课程资料"); // back
    await clickText("ClassFlow 上下文");
    const contextMenu = q('[role="menu"][aria-label="选择上下文"]')!;
    expect(contextMenu.textContent).toContain("中级计量经济学");
    await act(async () => {
      (contextMenu.querySelector("button") as HTMLButtonElement).click();
    });
    await flush();
    expect(handlers.onAddContext).toHaveBeenCalledTimes(1);
  });
});

describe("Kiro Composer P3 — Access（访问）", () => {
  it("一级 label 映射（OFF → 仅对话；guided → 受控访问）", async () => {
    await renderComposer({ computerEnabled: false });
    expect(q('[data-testid="kiro-composer-access"]')!.textContent).toContain("仅对话");
    rerenderComposer({ computerEnabled: true, agentMode: "guided" });
    expect(q('[data-testid="kiro-composer-access"]')!.textContent).toContain("受控访问");
    rerenderComposer({ computerEnabled: true, agentMode: "workspace-auto" });
    const auto = q('[data-testid="kiro-composer-access"]')!;
    expect(auto.textContent).toContain("自动执行");
    expect(auto.getAttribute("data-access-mode")).toBe("workspace-auto");
    expect(auto.className).toContain("text-danger");
  });

  it("菜单：四态 radio + 工作范围 + 权限摘要（已允许/未允许）+ 管理入口", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-access"]');
    const menu = q('[data-testid="kiro-composer-access-menu"]')!;
    const radios = menu.querySelectorAll('[role="menuitemradio"]');
    expect(radios.length).toBe(4);
    expect(menu.textContent).toContain("仅对话");
    expect(menu.textContent).toContain("仅规划");
    expect(menu.textContent).toContain("受控访问");
    expect(menu.textContent).toContain("自动执行");
    expect(q('[data-testid="kiro-composer-access-workspace"]')!.textContent).toContain("ClassFlow Desktop");
    const rows = container!.querySelectorAll('[data-testid="kiro-composer-permission-row"]');
    expect(rows.length).toBe(4);
    expect(text()).toContain("终端");
    expect(text()).toContain("查看桌面");
    expect(text()).toContain("操作电脑");
    expect(text()).toContain("剪贴板");
    expect(text()).toContain("已允许");
    expect(text()).toContain("未允许");
    // 不声称 runtime availability
    expect(text()).not.toContain("可用");
    await clickText("管理 Agent 权限");
    expect(handlers.onOpenAgentSettings).toHaveBeenCalledTimes(1);
  });

  it("选择 受控访问 → 开启 Computer + 写入 guided；选择 仅对话 → 关闭 Computer", async () => {
    await renderComposer({ computerEnabled: false });
    await click('[data-testid="kiro-composer-access"]');
    await clickText("受控访问");
    expect(handlers.onToggleComputer).toHaveBeenCalledWith(true);
    expect(handlers.onSetAgentMode).toHaveBeenCalledWith("guided");

    vi.clearAllMocks();
    await renderComposer({ computerEnabled: true, agentMode: "guided" });
    await click('[data-testid="kiro-composer-access"]');
    await clickText("仅对话");
    expect(handlers.onToggleComputer).toHaveBeenCalledWith(false);
  });

  it("Turn 运行中：仅对话禁用；plan/guided/auto 在 intent 冻结后可改", async () => {
    await renderComposer({ turnInFlight: true, turnIntentFrozen: true });
    await click('[data-testid="kiro-composer-access"]');
    const radios = Array.from(
      container!.querySelectorAll('[data-testid="kiro-composer-access-menu"] [role="menuitemradio"]')
    ) as HTMLButtonElement[];
    // [仅对话, 仅规划, 受控访问, 自动执行]
    expect(radios[0].disabled).toBe(true);
    expect(radios[1].disabled).toBe(false);
    expect(radios[2].disabled).toBe(false);
    expect(radios[3].disabled).toBe(false);
    await act(async () => radios[3].click());
    await flush();
    expect(handlers.onSetAgentMode).toHaveBeenCalledWith("workspace-auto");
  });

  it("preparing 且 intent 未冻结：plan/guided/auto 同样禁用", async () => {
    await renderComposer({ turnInFlight: true, preparingSend: true, turnIntentFrozen: false });
    await click('[data-testid="kiro-composer-access"]');
    const radios = Array.from(
      container!.querySelectorAll('[data-testid="kiro-composer-access-menu"] [role="menuitemradio"]')
    ) as HTMLButtonElement[];
    expect(radios.every((r) => r.disabled)).toBe(true);
  });

  it("grantWarning 迁移到 Access（warning token，不用 danger）", async () => {
    await renderComposer({ grantWarning: "需要重新授权" });
    const trigger = q('[data-testid="kiro-composer-access"]')!;
    expect(trigger.querySelector(".bg-warning")).toBeTruthy();
    await click('[data-testid="kiro-composer-access"]');
    const workspaceBlock = q('[data-testid="kiro-composer-access-workspace"]')!;
    expect(workspaceBlock.textContent).toContain("需要重新授权");
    expect(workspaceBlock.querySelector(".text-warning")).toBeTruthy();
  });
});

describe("Kiro Composer P3 — Reasoning 滑块（Model 左侧）", () => {
  it("一级 trigger 显示当前档位；可调时存在", async () => {
    await renderComposer();
    const reasoning = q('[data-testid="kiro-composer-reasoning"]')!;
    expect(reasoning.textContent).toContain("高");
    expect(reasoning.getAttribute("aria-label")).toBe("思考程度");
  });

  it("fixed reasoning → 不渲染 Reasoning 控件", async () => {
    await renderComposer({ reasoningCapability: FIXED });
    expect(q('[data-testid="kiro-composer-reasoning"]')).toBeNull();
  });

  it("弹层：当前档位 + 模型名 + 分段滑块（dots = supportedEfforts）+ 键盘调整", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-reasoning"]');
    const menu = q('[data-testid="kiro-composer-reasoning-menu"]')!;
    expect(menu.textContent).toContain("高");
    expect(menu.textContent).toContain("GPT-5.6 Sol");
    const slider = menu.querySelector('[role="slider"]')!;
    expect(slider.getAttribute("aria-valuemax")).toBe("2");
    expect(slider.getAttribute("aria-valuenow")).toBe("2");
    // 每个 supportedEffort 一个 dot（3 档）
    expect(menu.querySelectorAll("span.rounded-full.w-1\\.5").length).toBe(3);
    // 键盘 ← 降低一档
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    await flush();
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("medium");
  });

  it("↺ 恢复默认（default）", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-reasoning"]');
    await click('[aria-label="恢复默认思考程度"]');
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("default");
  });

  it("Computer OFF 仍可修改 Reasoning（与 Computer 解耦）", async () => {
    await renderComposer({ computerEnabled: false });
    const reasoning = q('[data-testid="kiro-composer-reasoning"]') as HTMLButtonElement;
    expect(reasoning).toBeTruthy();
    expect(reasoning.disabled).toBe(false);
    await click('[data-testid="kiro-composer-reasoning"]');
    expect(q('[data-testid="kiro-composer-reasoning-menu"]')).toBeTruthy();
  });

  it("preparing 且 intent 未冻结 → Reasoning 禁用（preference lock）", async () => {
    await renderComposer({ turnInFlight: true, preparingSend: true, turnIntentFrozen: false });
    expect((q('[data-testid="kiro-composer-reasoning"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Kiro Composer P3 — Model", () => {
  it("一级只显示模型名（思考程度已独立）", async () => {
    await renderComposer();
    const model = q('[data-testid="kiro-composer-model"]')!;
    expect(model.textContent).toContain("GPT-5.6 Sol");
    expect(model.textContent).not.toContain("·");
  });

  it("菜单：模型列表；不含思考程度区", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-model"]');
    const menu = q('[data-testid="kiro-composer-model-menu"]')!;
    expect(menu.textContent).toContain("Claude X");
    expect(menu.textContent).not.toContain("思考程度");
    await clickText("Claude X");
    expect(handlers.onSelectModel).toHaveBeenCalledWith("claude-x");
  });

  it("modelUnavailable 仍显示真实 warning", async () => {
    await renderComposer({ modelUnavailable: true, activeModelName: "模型不可用" });
    await click('[data-testid="kiro-composer-model"]');
    expect(q('[data-testid="kiro-composer-model-menu"]')!.textContent).toContain("当前模型已不可用");
  });
});
describe("Kiro Composer P3 — 菜单互斥 / 回归", () => {
  it("单一菜单 ownership：打开 Access 时关闭 Add", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    expect(q('[data-testid="kiro-composer-add-menu"]')).toBeTruthy();
    await click('[data-testid="kiro-composer-access"]');
    expect(q('[data-testid="kiro-composer-add-menu"]')).toBeNull();
    expect(q('[data-testid="kiro-composer-access-menu"]')).toBeTruthy();
  });

  it("Esc 关闭当前菜单（capture，不冒泡到全局快捷键）", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(q('[data-testid="kiro-composer-add-menu"]')).toBeNull();
  });

  it("附件 shelf / 拖拽 / 粘贴 handler 不回归", async () => {
    await renderComposer({
      attachments: [
        {
          id: "a1",
          kind: "document",
          name: "讲义.pdf",
          status: "ready",
          size: 1024,
        },
      ],
    });
    expect(q('[data-testid="kiro-attachments"]')).toBeTruthy();
    expect(text()).toContain("讲义.pdf");
    // 拖拽
    const composer = q('[data-testid="kiro-composer"]')!;
    const file = new File(["x"], "notes.md", { type: "text/markdown" });
    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
      composer.dispatchEvent(drop);
    });
    expect(handlers.onAddFiles).toHaveBeenCalledWith([file]);
  });

  it("Slash Skill 菜单不回归（/ 触发）", async () => {
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      skills: {
        list: async () => ({ skills: [{ name: "doc", description: "文档", enabled: true }] }),
      },
    };
    await renderComposer();
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(ta, "/d");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(q('[data-testid="skill-slash-menu"]')).toBeTruthy();
  });

  it("Send 生命周期：空文本不可发送；输入后可发送", async () => {
    await renderComposer();
    const sendButton = container!.querySelector('[aria-label="发送"]') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(ta, "你好");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const enabledSend = container!.querySelector('[aria-label="发送"]') as HTMLButtonElement;
    expect(enabledSend.disabled).toBe(false);
    await act(async () => enabledSend.click());
    await flush();
    expect(handlers.onSend).toHaveBeenCalledWith("你好");
  });
});
