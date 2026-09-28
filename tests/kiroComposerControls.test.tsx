// @vitest-environment jsdom
/**
 * Kiro Composer P3/P3.1 — 一级四入口 + Add / Access / Reasoning / Model 交互（精简版）。
 * 只保留必要行为断言；数据/映射细节由 tests/kiroComposerAccess.test.ts（纯函数）覆盖。
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
  supportedEfforts: ["default", "low", "medium", "high"],
  mechanism: "effort",
};
const FIXED: ReasoningCapability = { adjustable: false, supportedEfforts: ["default"], mechanism: "fixed" };

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
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function props(overrides: Record<string, unknown> = {}) {
  return {
    contexts: [],
    onAddContext: handlers.onAddContext,
    onRemoveContext: vi.fn(),
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
    root!.render(<KiroComposer {...(props(overrides) as never)} />);
  });
  await flush();
}

function rerender(overrides: Record<string, unknown> = {}) {
  act(() => {
    root!.render(<KiroComposer {...(props(overrides) as never)} />);
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
    courses: [{ id: "c1", name: "中级计量经济学", teacher: "王老师", materials: [{ id: "m1", title: "第三章讲义", type: "pdf" }] }] as never,
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

describe("Kiro Composer — 一级结构", () => {
  it("一级只有 ＋ / 访问 / 思考程度（模型左侧）/ 模型 / 发送", async () => {
    await renderComposer();
    const reasoning = q('[data-testid="kiro-composer-reasoning"]')!;
    const model = q('[data-testid="kiro-composer-model"]')!;
    expect(q('[data-testid="kiro-composer-add"]')).toBeTruthy();
    expect(q('[data-testid="kiro-composer-access"]')).toBeTruthy();
    expect(q('[aria-label="发送"]')).toBeTruthy();
    expect(reasoning.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 旧一级入口全部收进二级
    for (const label of ["选择上下文", "联网搜索", "Computer", "权限模式"]) {
      expect(q(`[aria-label="${label}"]`), label).toBeNull();
    }
  });

  it("Reasoning 按钮宽度固定（label 槽位固定 → 切换档位不横移）", async () => {
    await renderComposer();
    const trigger = q('[data-testid="kiro-composer-reasoning"]')!;
    expect(trigger.className).toContain("w-16");
    expect(q('[data-testid="kiro-composer-reasoning-label"]')!.className).toContain("w-6");
    rerender({ reasoningEffort: "low" });
    expect(q('[data-testid="kiro-composer-reasoning"]')!.className).toContain("w-16");
  });
});

describe("Kiro Composer — Add Menu", () => {
  it("内容与来源：上传文件 / 添加图片 / 课程资料 / 上下文 + 联网搜索（状态与切换）", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    const menu = q('[data-testid="kiro-composer-add-menu"]')!;
    for (const label of ["上传文件", "添加图片", "课程资料", "ClassFlow 上下文", "联网搜索"]) {
      expect(menu.textContent, label).toContain(label);
    }
    const web = q('[data-testid="kiro-composer-web-search"]') as HTMLButtonElement;
    expect(web.getAttribute("aria-checked")).toBe("false");
    await act(async () => web.click());
    await flush();
    expect(useKiroPreferencesStore.getState().webSearchEnabled).toBe(true);
  });

  it("课程资料与上下文为同一 Popover 内的子视图", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    await clickText("课程资料");
    expect(text()).toContain("第三章讲义");
    await clickText("课程资料"); // 返回
    await clickText("ClassFlow 上下文");
    const contextMenu = q('[role="menu"][aria-label="选择上下文"]')!;
    await act(async () => (contextMenu.querySelector("button") as HTMLButtonElement).click());
    await flush();
    expect(handlers.onAddContext).toHaveBeenCalledTimes(1);
  });

  it("锁语义：Turn 中 scope 条目禁用但联网搜索可切换；preparing 未冻结时联网搜索禁用", async () => {
    await renderComposer({ turnInFlight: true, turnIntentFrozen: true });
    await click('[data-testid="kiro-composer-add"]');
    const upload = Array.from(container!.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("上传文件")
    ) as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    expect((q('[data-testid="kiro-composer-web-search"]') as HTMLButtonElement).disabled).toBe(false);

    // 菜单保持打开；preparing 且 intent 未冻结 → preference 锁生效
    rerender({ turnInFlight: true, preparingSend: true, turnIntentFrozen: false });
    await flush();
    expect((q('[data-testid="kiro-composer-web-search"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Kiro Composer — Access", () => {
  it("一级 label 映射与 danger 语义", async () => {
    await renderComposer({ computerEnabled: false });
    expect(q('[data-testid="kiro-composer-access"]')!.textContent).toContain("仅对话");
    rerender({ computerEnabled: true, agentMode: "guided" });
    expect(q('[data-testid="kiro-composer-access"]')!.textContent).toContain("受控访问");
    rerender({ computerEnabled: true, agentMode: "workspace-auto" });
    const auto = q('[data-testid="kiro-composer-access"]')!;
    expect(auto.textContent).toContain("自动执行");
    expect(auto.className).toContain("text-danger");
  });

  it("菜单：模式选择回调 / 工作范围 + warning / 权限摘要 / 管理入口", async () => {
    await renderComposer({ computerEnabled: false, grantWarning: "需要重新授权" });
    await click('[data-testid="kiro-composer-access"]');
    const menu = q('[data-testid="kiro-composer-access-menu"]')!;
    expect(menu.querySelectorAll('[role="menuitemradio"]').length).toBe(4);
    expect(q('[data-testid="kiro-composer-access-workspace"]')!.textContent).toContain("ClassFlow Desktop");
    expect(q('[data-testid="kiro-composer-access-workspace"]')!.textContent).toContain("需要重新授权");
    expect(container!.querySelectorAll('[data-testid="kiro-composer-permission-row"]').length).toBe(4);
    expect(text()).toContain("已允许");
    expect(text()).toContain("未允许");

    await clickText("受控访问");
    expect(handlers.onToggleComputer).toHaveBeenCalledWith(true);
    expect(handlers.onSetAgentMode).toHaveBeenCalledWith("guided");

    await click('[data-testid="kiro-composer-access"]');
    await clickText("管理 Agent 权限");
    expect(handlers.onOpenAgentSettings).toHaveBeenCalledTimes(1);
  });

  it("仅对话 → 关闭 Computer；Turn 中仅对话禁用而三档可改", async () => {
    await renderComposer({ computerEnabled: true, agentMode: "guided" });
    await click('[data-testid="kiro-composer-access"]');
    await clickText("仅对话");
    expect(handlers.onToggleComputer).toHaveBeenCalledWith(false);

    vi.clearAllMocks();
    rerender({ turnInFlight: true, turnIntentFrozen: true });
    await flush();
    await click('[data-testid="kiro-composer-access"]');
    const radios = Array.from(
      container!.querySelectorAll('[data-testid="kiro-composer-access-menu"] [role="menuitemradio"]')
    ) as HTMLButtonElement[];
    expect(radios[0].disabled).toBe(true);
    expect(radios.slice(1).every((r) => !r.disabled)).toBe(true);
  });
});

describe("Kiro Composer — Reasoning / Model", () => {
  it("Reasoning：点击档位不关闭弹窗、↺ 恢复默认；fixed → 不渲染；Computer OFF 可调", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-reasoning"]');
    const radios = container!.querySelectorAll(
      '[data-testid="kiro-composer-reasoning-track"] [role="radio"]'
    ) as NodeListOf<HTMLButtonElement>;
    expect(radios.length).toBe(4);
    await act(async () => radios[1].click());
    await flush();
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("low");
    expect(q('[data-testid="kiro-composer-reasoning-menu"]')).toBeTruthy();
    await click('[aria-label="恢复默认思考程度"]');
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("default");

    rerender({ reasoningCapability: FIXED });
    expect(q('[data-testid="kiro-composer-reasoning"]')).toBeNull();

    rerender({ computerEnabled: false });
    await flush();
    await click('[data-testid="kiro-composer-reasoning"]');
    expect(q('[data-testid="kiro-composer-reasoning-menu"]')).toBeTruthy();
  });

  it("Reasoning 滑块：最高档填满轨道 + knob 贴右端（w-8，无 hover 位移）；档位点保持小尺寸", async () => {
    await renderComposer(); // reasoningEffort: "high" = 最高档（ADJUSTABLE 的最后一档）
    await click('[data-testid="kiro-composer-reasoning"]');
    const fill = q('[data-testid="kiro-composer-reasoning-fill"]')!;
    expect(fill.style.width).toBe("100%");
    const knob = q('[data-testid="kiro-composer-reasoning-knob"]')!;
    expect(knob.style.left).toBe("calc(100% - 16px)");
    expect(knob.className).toContain("w-8");
    // 去除浮起效果：不残留 hover 位移/缩放
    expect(knob.className).not.toContain("group-hover/track");
    // 固定档位点不被放大
    const dots = container!.querySelectorAll('[data-testid="kiro-composer-reasoning-dot"]');
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of Array.from(dots)) {
      expect(dot.className).toContain("w-1.5");
      expect(dot.className).not.toContain("w-2");
    }
  });

  it("最高档流动彩条：max 显现 crossfade，非 max 隐藏；底填充过渡保留", async () => {
    const MAXABLE = { adjustable: true, supportedEfforts: ["default", "low", "high", "max"], mechanism: "effort" };
    await renderComposer({ reasoningCapability: MAXABLE, reasoningEffort: "max" });
    await click('[data-testid="kiro-composer-reasoning"]');
    const track = q('[data-testid="kiro-composer-reasoning-track"]')!;
    expect(track.getAttribute("data-max")).toBe("true");
    const flow = q('[data-testid="kiro-composer-reasoning-flow"]')!;
    // 流动层：与底填充同宽 + 显现（500ms 柔光晕染，非颜色跳变）+ 宽高同过渡不断档
    expect(flow.className).toContain("kiro-reasoning-flow-fade");
    expect(flow.className).toContain("opacity-100");
    expect(flow.style.width).toBe("100%");
    // 彩带：200% 宽 + 位移动画类（compositor 合成；高饱和亮色）
    const strip = q('[data-testid="kiro-composer-reasoning-flow-strip"]')!;
    expect(strip.className).toContain("kiro-reasoning-flow");
    expect(strip.className).toContain("w-[200%]");
    // 底填充保留 width 过渡（档位滑动不断）
    expect(q('[data-testid="kiro-composer-reasoning-fill"]')!.className).toContain("transition-[width]");
  });

  it("非最高档：流动层隐藏（opacity-0），底填充正常", async () => {
    await renderComposer({ reasoningEffort: "low" });
    await click('[data-testid="kiro-composer-reasoning"]');
    const flow = q('[data-testid="kiro-composer-reasoning-flow"]')!;
    expect(flow.className).toContain("opacity-0");
    expect(q('[data-testid="kiro-composer-reasoning-track"]')!.getAttribute("data-max")).toBeNull();
  });

  it("流动彩条 CSS：位移动画无缝循环 + 亮色低饱和 + reduced-motion 静止保彩", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    // 位移（compositor）而非 background-position（重绘）；-50% 恰为一个色带周期
    expect(css).toContain("transform: translateX(-50%)");
    expect(css).not.toMatch(/kiro-reasoning-flow-slide[\s\S]{0,200}?background-position/);
    // 亮色低饱和（200 档粉彩）；色带以 50% 为周期重复（0/50/100% 同色 → 首尾帧一致，不断档）
    for (const hex of ["#FDE68A", "#FECDD3", "#DDD6FE", "#BAE6FD"]) {
      expect(css).toContain(hex);
    }
    expect(css).toContain("#FDE68A 0%");
    expect(css).toContain("#FDE68A 50%");
    expect(css).toContain("#FDE68A 100%");
    // reduced-motion：动画停但保留静态彩条
    expect(css).toContain("html[data-motion-effective=\"reduced\"] .kiro-reasoning-flow");
  });

  it("Reasoning 拖动：按指针位置换算档位（pointerdown → pointermove），拖动期间关闭过渡", async () => {
    await renderComposer({ reasoningEffort: "low" });
    await click('[data-testid="kiro-composer-reasoning"]');
    const track = q('[data-testid="kiro-composer-reasoning-track"]')!;
    // jsdom 无布局：固定轨道几何（0..400px，4 档 → 每档 100px）
    Object.defineProperty(track, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 400, height: 36, right: 400, bottom: 36, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const firePointer = (type: string, clientX: number) => {
      const ev = new Event(type, { bubbles: true }) as Event & { clientX?: number };
      Object.defineProperty(ev, "clientX", { value: clientX });
      track.dispatchEvent(ev);
    };

    await act(async () => {
      firePointer("pointerdown", 220); // 55% → 第 3 段 → 中
    });
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("medium");
    // 仅按下不算拖动；单击/拖动都保留 knob/fill 过渡（档位间平滑滑动）
    expect(track.getAttribute("data-dragging")).toBeNull();
    expect(q('[data-testid="kiro-composer-reasoning-fill"]')!.className).toContain("transition-[width]");

    await act(async () => {
      firePointer("pointermove", 320); // 第 4 段 → 高（进入拖动）
    });
    expect(handlers.onSetReasoningEffort).toHaveBeenCalledWith("high");
    expect(track.getAttribute("data-dragging")).toBe("true");
    // 拖动过程中动画不缺失
    expect(q('[data-testid="kiro-composer-reasoning-fill"]')!.className).toContain("transition-[width]");
    expect(q('[data-testid="kiro-composer-reasoning-fill"]')!.className).not.toContain("transition-none");
    expect(q('[data-testid="kiro-composer-reasoning-knob"]')!.className).toContain("transition-[left]");

    await act(async () => {
      firePointer("pointerup", 380);
    });
    expect(track.getAttribute("data-dragging")).toBeNull();
    expect(q('[data-testid="kiro-composer-reasoning-fill"]')!.className).not.toContain("transition-none");
  });

  it("Model：只显示模型名，菜单不含思考程度；unavailable 显示 warning", async () => {
    await renderComposer();
    const model = q('[data-testid="kiro-composer-model"]')!;
    expect(model.textContent).toContain("GPT-5.6 Sol");
    expect(model.textContent).not.toContain("·");
    await click('[data-testid="kiro-composer-model"]');
    const menu = q('[data-testid="kiro-composer-model-menu"]')!;
    expect(menu.textContent).toContain("Claude X");
    expect(menu.textContent).not.toContain("思考程度");
    await clickText("Claude X");
    expect(handlers.onSelectModel).toHaveBeenCalledWith("claude-x");

    rerender({ modelUnavailable: true, activeModelName: "模型不可用" });
    await flush();
    await click('[data-testid="kiro-composer-model"]');
    expect(q('[data-testid="kiro-composer-model-menu"]')!.textContent).toContain("当前模型已不可用");
  });

  it("S-fix 模型不可用时发送前即禁用（不再白等一轮 MODEL_NOT_FOUND）", async () => {
    await renderComposer({ modelUnavailable: true, activeModelName: "模型不可用" });
    const ta = q('textarea[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(ta, "帮我总结");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const send = q('[aria-label="发送"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () => {
      send.click();
    });
    await flush();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });
});

describe("Kiro Composer — 回归", () => {
  it("菜单互斥 + Esc 关闭（受控状态）", async () => {
    await renderComposer();
    await click('[data-testid="kiro-composer-add"]');
    expect(q('[data-testid="kiro-composer-add"]')!.getAttribute("aria-expanded")).toBe("true");
    await click('[data-testid="kiro-composer-access"]');
    expect(q('[data-testid="kiro-composer-add"]')!.getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-testid="kiro-composer-access"]')!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(q('[data-testid="kiro-composer-access"]')!.getAttribute("aria-expanded")).toBe("false");
  });

  it("附件 shelf / 拖拽 / Slash / Send 不回归", async () => {
    await renderComposer({
      attachments: [{ id: "a1", kind: "document", name: "讲义.pdf", status: "ready", size: 1024 }],
    });
    expect(q('[data-testid="kiro-attachments"]')).toBeTruthy();

    const file = new File(["x"], "notes.md", { type: "text/markdown" });
    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
      q('[data-testid="kiro-composer"]')!.dispatchEvent(drop);
    });
    expect(handlers.onAddFiles).toHaveBeenCalledWith([file]);

    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      skills: { list: async () => ({ skills: [{ name: "doc", description: "文档", enabled: true, kind: "workflow" }] }) },
    };
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, "/d");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(q('[data-testid="skill-slash-menu"]')).toBeTruthy();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, "你好");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const send = container!.querySelector('[aria-label="发送"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    await flush();
    expect(handlers.onSend).toHaveBeenCalledWith("你好");
  });
});

describe("Kiro Composer — @ mention（对标 Slash）", () => {
  async function typeText(value: string) {
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  async function pressKey(key: string) {
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    await flush();
  }

  it("@ 展开上下文菜单；选中回填文本 + 写入 Manual chip", async () => {
    await renderComposer();
    await typeText("帮我看下@中级");
    expect(q('[data-testid="kiro-mention-menu"]')).toBeTruthy();
    const item = q('[data-testid="kiro-mention-item-manual-course-c1"]') as HTMLButtonElement;
    expect(item).toBeTruthy();
    await act(async () => {
      item.click();
    });
    await flush();
    expect(handlers.onAddContext).toHaveBeenCalledWith(
      expect.objectContaining({ key: "manual-course-c1", kind: "course" })
    );
    const ta = q('[aria-label="Ask Kiro"]') as HTMLTextAreaElement;
    expect(ta.value).toBe("帮我看下@中级计量经济学（王老师） ");
    // 尾随空格 = 完成态，不再弹出
    expect(q('[data-testid="kiro-mention-menu"]')).toBeNull();
  });

  it("无命中关闭；Escape 关闭；键盘导航选中", async () => {
    await renderComposer();
    await typeText("@不存在的");
    expect(q('[data-testid="kiro-mention-menu"]')).toBeNull();

    await typeText("@");
    expect(q('[data-testid="kiro-mention-menu"]')).toBeTruthy();
    await pressKey("Escape");
    expect(q('[data-testid="kiro-mention-menu"]')).toBeNull();

    // 文本变化才重开（设相同值 React 不触发 onChange，属测试约束非业务问题）
    await typeText("k @");
    expect(q('[data-testid="kiro-mention-menu"]')).toBeTruthy();
    await pressKey("ArrowDown");
    await pressKey("Enter");
    await flush();
    // 组序：课程 → 本周 → 下周 → 资料；index 1 = 本周
    expect(handlers.onAddContext).toHaveBeenCalledWith(
      expect.objectContaining({ key: "manual-week-current" })
    );
  });
});
