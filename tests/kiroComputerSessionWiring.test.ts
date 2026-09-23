// @vitest-environment node
/**
 * P5 接线守卫（源码断言）：
 * - Desktop Session subscription ownership 唯一（Provider 根部 Host；UI 不订阅 Electron event）；
 * - Workspace / Sidecar 共用同一个 Computer Session Surface（无旧 Card 双份 UI）；
 * - Preview evidence 由 useKiroChat → executor callback 注入（executor 不依赖 UI store）；
 * - 旧 Card 已删除；Inspector 未恢复 Computer 栏。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 源码扫描：剥离注释（注释中的禁止说明不算违规） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("P5 Subscription ownership 接线", () => {
  it("Host 挂在 KiroSessionProvider 持久根部（与 Sidecar 生命周期解耦）", () => {
    const provider = read("components/kiro/KiroSessionProvider.tsx");
    expect(provider).toContain("<KiroComputerSessionHost />");
    // Provider 根部（children 之后、Sidecar 之前）——不是 Sidecar 内部
    const hostIndex = provider.indexOf("<KiroComputerSessionHost />");
    const sidecarIndex = provider.indexOf("<KiroSidecar mode=");
    expect(hostIndex).toBeGreaterThan(-1);
    expect(sidecarIndex).toBeGreaterThan(hostIndex);
  });

  it("只有 Host 调用 subscribeSession；Sidecar / Surface / ChatSurface 不订阅", () => {
    const host = read("components/kiro/computer/KiroComputerSessionHost.tsx");
    expect(host).toContain("bridge.subscribeSession(");
    for (const file of [
      "components/kiro/KiroSidecar.tsx",
      "components/kiro/KiroChatSurface.tsx",
      "components/kiro/computer/session/KiroComputerSessionSurface.tsx",
      "components/kiro/computer/session/KiroComputerSessionPreview.tsx",
      "components/kiro/computer/session/useKiroComputerSessionActions.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("subscribeSession");
    }
  });

  it("旧 KiroComputerSessionCard 已删除（无第二份 UI）", () => {
    expect(existsSync(join(process.cwd(), "components/kiro/computer/KiroComputerSessionCard.tsx"))).toBe(
      false
    );
    expect(read("components/kiro/KiroSidecar.tsx")).not.toContain("KiroComputerSessionCard");
  });
});

describe("P5 Shared Surface 接线", () => {
  it("KiroChatSurface 统一渲染 Surface（Workspace + Sidecar 同一组件）", () => {
    const surface = read("components/kiro/KiroChatSurface.tsx");
    expect(surface).toContain("<KiroComputerSessionSurface variant={variant} />");
    expect(surface).toContain('variant: "workspace" | "sidecar"');
  });

  it("Surface 不做 Approval 决策 / 不复制 Worklog", () => {
    const surface = read("components/kiro/computer/session/KiroComputerSessionSurface.tsx");
    expect(surface).not.toContain("KiroInlineApproval");
    expect(surface).not.toContain("ComputerApprovalDialog");
    expect(surface).not.toContain("KiroWorklogTimeline");
    expect(surface).not.toContain("allowedDecisions");
  });

  it("Inspector 未恢复 Computer 栏", () => {
    const inspector = read("components/kiro/inspector/KiroInspector.tsx");
    expect(inspector).not.toContain("Computer");
  });
});

describe("P5 Preview evidence 依赖方向", () => {
  it("useKiroChat 注入 callback（executor 不 import UI store）", () => {
    const chat = read("hooks/useKiroChat.ts");
    expect(chat).toContain("onDesktopObservationEvidence");
    expect(chat).toContain("useDesktopSessionPreviewStore.getState().setPreview(evidence)");
    const executor = read("lib/ai/computer/executor.ts");
    expect(executor).not.toContain("useDesktopSessionPreviewStore");
    const observe = read("lib/ai/computer/desktop/observe.ts");
    expect(observe).not.toContain("useDesktopSessionPreviewStore");
    const guiExecutor = read("lib/ai/computer/gui/executor.ts");
    expect(guiExecutor).not.toContain("useDesktopSessionPreviewStore");
  });

  it("Tool Output 只走 summarizeObservation（dataUrl 不进入模型）", () => {
    const summary = stripComments(read("lib/ai/computer/desktop/summary.ts"));
    expect(summary).not.toContain("dataUrl");
  });

  it("Main session event 携带 sanitized failureReason（optional 向后兼容）", () => {
    const types = read("lib/desktop/types.ts");
    expect(types).toContain("failureReason?: string | null");
    const main = read("src/main/computer/session.ts");
    expect(main).toContain("failureReason: record.failureReason");
  });
});
