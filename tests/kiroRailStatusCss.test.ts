// @vitest-environment node
/**
 * Kiro Rail Runtime Status V1 — Brand Motion CSS / 接线契约（source lock）。
 *
 * 验证四种状态的动作语义与 Reduced Motion 契约：
 * - idle：静态（不旋转）
 * - thinking：极弱 pulse（不旋转）
 * - computer-active：唯一 ring movement（flow-angle-spin）
 * - waiting-approval：amber 静态（不旋转 / 不 pulse）
 * - Reduced Motion：全部 animation: none，但状态仍可区分（opacity / background）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

const css = read("app/globals.css");
// S5：遗留 KiroThreadRail 已删除；Plate 契约由现役 KiroNavigatorPlate 继承
const railSrc = read("components/kiro/navigation/KiroNavigatorPlate.tsx");
const navigatorSrc = read("components/kiro/navigation/KiroNavigator.tsx");
const providerSrc = read("components/kiro/KiroSessionProvider.tsx");
const chatSrc = read("hooks/useKiroChat.ts");

function ruleBlock(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return open === -1 || close === -1 ? "" : css.slice(open + 1, close);
}

describe("Kiro Rail Runtime Status V1 — CSS 状态语义", () => {
  it("四种状态选择器齐备", () => {
    for (const status of ["idle", "thinking", "computer-active", "waiting-approval"]) {
      expect(css).toContain(`.kiro-rail-plate[data-kiro-status="${status}"] .kiro-ring`);
    }
  });

  it("idle：静态品牌环（不旋转 / 不 pulse）", () => {
    const block = ruleBlock('.kiro-rail-plate[data-kiro-status="idle"] .kiro-ring');
    expect(block).toContain("animation: none");
    expect(block).not.toContain("flow-angle-spin");
    expect(block).toContain("opacity: 0.64");
  });

  it("thinking：有 pulse 且绝不出现 ring rotation", () => {
    const block = ruleBlock('.kiro-rail-plate[data-kiro-status="thinking"] .kiro-ring');
    expect(block).toContain("kiro-rail-thinking-pulse");
    expect(block).not.toContain("flow-angle-spin");
    // pulse 只变 opacity（不做 scale breathing）
    const keyframes = css.slice(
      css.indexOf("@keyframes kiro-rail-thinking-pulse"),
      css.indexOf("}", css.indexOf("@keyframes kiro-rail-thinking-pulse")) + 200
    );
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toContain("scale");
  });

  it("computer-active：唯一使用 flow-angle-spin 的 Rail 状态", () => {
    const block = ruleBlock('.kiro-rail-plate[data-kiro-status="computer-active"] .kiro-ring');
    expect(block).toContain("flow-angle-spin");
    expect(block).toContain("--kiro-computer-ring-duration");
    expect(block).toContain("linear infinite");
    expect(css).toContain("--kiro-computer-ring-duration: 4.2s;");
  });

  it("waiting-approval：amber 静态（不旋转 / 不 pulse / 不用危险红）", () => {
    const block = ruleBlock('.kiro-rail-plate[data-kiro-status="waiting-approval"] .kiro-ring');
    expect(block).toContain("animation: none");
    expect(block).toContain("var(--kiro-approval-ring)");
    expect(block).not.toContain("flow-angle-spin");
    expect(block).not.toContain("kiro-rail-thinking-pulse");
    // amber token 与现有 warning token 协调（复用 warning 色系）
    expect(css).toContain("--kiro-approval-ring:");
    expect(css).toContain("--warning: #936E4C;");
    expect(css).toContain("--warning-border: #DFD2C2;");
  });

  it("Hover / Focus 只提升 opacity，不覆盖 Runtime 状态动画", () => {
    const hoverIdle = ruleBlock(
      '.group\\/plate:hover .kiro-rail-plate[data-kiro-status="idle"] .kiro-ring'
    );
    expect(hoverIdle).toContain("opacity");
    expect(hoverIdle).not.toContain("flow-angle-spin");
    // thinking hover 不切换动画：不存在 thinking 的 hover 覆盖规则
    expect(css).not.toContain(
      '.group\\/plate:hover .kiro-rail-plate[data-kiro-status="thinking"] .kiro-ring'
    );
    // computer-active hover 保持 ring movement（只加 opacity）
    const hoverActive = ruleBlock(
      '.group\\/plate:hover .kiro-rail-plate[data-kiro-status="computer-active"] .kiro-ring'
    );
    expect(hoverActive).toContain("opacity");
    expect(hoverActive).not.toContain("animation");
  });

  it("emphasized 只影响视觉权重（不改变状态动画）", () => {
    expect(css).toContain('.kiro-rail-plate[data-emphasized][data-kiro-status="idle"] .kiro-ring');
    const emphasizedIdle = ruleBlock(
      '.kiro-rail-plate[data-emphasized][data-kiro-status="idle"] .kiro-ring'
    );
    expect(emphasizedIdle).toContain("opacity");
    expect(emphasizedIdle).not.toContain("flow-angle-spin");
  });

  it("Reduced Motion：Rail 状态全部 animation: none，但仍保留状态区分", () => {
    expect(css).toContain(
      'html[data-motion-effective="reduced"] .kiro-rail-plate[data-kiro-status] .kiro-ring'
    );
    for (const status of ["idle", "thinking", "computer-active", "waiting-approval"]) {
      const block = ruleBlock(
        `html[data-motion-effective="reduced"] .kiro-rail-plate[data-kiro-status="${status}"] .kiro-ring`
      );
      expect(block, `reduced-motion block for ${status}`).not.toBe("");
      expect(block).not.toContain("flow-angle-spin");
      expect(block).not.toContain("kiro-rail-thinking-pulse");
      expect(block).toMatch(/opacity/);
    }
    // waiting-approval 在 reduced motion 下仍保持 amber
    const reducedApproval = ruleBlock(
      'html[data-motion-effective="reduced"] .kiro-rail-plate[data-kiro-status="waiting-approval"] .kiro-ring'
    );
    expect(reducedApproval).toContain("var(--kiro-approval-ring)");
  });
});

describe("Kiro Rail Runtime Status V1 — 组件接线", () => {
  it("Navigator Plate 只输出 data-kiro-status / data-emphasized（不再输出 data-kiro-flow）", () => {
    expect(railSrc).toContain("data-kiro-status={status}");
    expect(railSrc).toContain("data-emphasized={emphasized || undefined}");
    expect(railSrc).not.toContain("data-kiro-flow");
  });

  it("Navigator 不自行推导状态（只消费 meta，不过 active/flow boolean 判断）", () => {
    expect(navigatorSrc).not.toContain('const flow: "ambient" | "active" | "working"');
    expect(navigatorSrc).toContain("meta.kiroRuntimeStatus");
  });

  it("Provider：由真实 Runtime Fact 解析并进入 Meta Context（低频 scalar）", () => {
    expect(providerSrc).toContain("resolveKiroRuntimeStatus({");
    expect(providerSrc).toContain("computerActive: chat.computerActive");
    expect(providerSrc).toContain("waitingApproval");
    expect(providerSrc).toContain("kiroRuntimeStatus: KiroRuntimeStatus;");
    expect(providerSrc).toContain("kiroRuntimeStatus,");
  });

  it("useKiroChat：computerActive 来自真实 Computer Task（非 terminalRunning / shellExecuting）", () => {
    expect(chatSrc).toContain("const computerActive = useMemo(");
    expect(chatSrc).toContain('task.status === "running"');
    expect(chatSrc).not.toContain("terminalRunning");
    expect(chatSrc).not.toContain("shellExecuting");
  });

  it("旧 data-kiro-flow 消费者仍存在（本任务只迁移 Thread Rail）", () => {
    const sidebarSrc = read("components/layout/Sidebar.tsx");
    const capsuleSrc = read("components/kiro/sidecar/KiroSidecarMinimized.tsx");
    expect(sidebarSrc).toContain("data-kiro-flow");
    expect(capsuleSrc).toContain("data-kiro-flow");
    // 旧 CSS 规则保留（迁移完成前不全局删除）
    expect(css).toContain('.kiro-capsule[data-kiro-flow="ambient"]');
  });
});
