// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Phase3 Workspace Polish", () => {
  it("Composer P3: Reasoning 与 Computer 解耦；Agent Mode 收进 Access", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
    // Reasoning 只由模型 capability 驱动（Computer OFF 也可调整）
    expect(src).toContain("<KiroComposerReasoningControl");
    expect(src).not.toContain("computerEnabled && reasoningCapability");
    // Agent Mode 不再是一级控件（Access 菜单内选择）
    expect(src).not.toContain("computerEnabled && agentMode");
    expect(src).toContain("<KiroComposerAccessControl");
  });

  it("Inbox filter uses Button primitive", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/inbox/InboxPanel.tsx"), "utf8");
    expect(src).toContain("from \"@/components/ui/Button\"");
    expect(src).toContain("inbox-filter-unread");
  });

  it("Channel copy productized", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/ChannelSettings.tsx"), "utf8");
    expect(src).not.toContain("仅存于 SecretVault");
    expect(src).toContain("凭据会安全保存在当前设备");
    expect(src).not.toContain("receive-only");
    expect(src).toContain("是否交给 Kiro 处理由你决定");
  });

  it("Settings reduced motion respects preference", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/SettingsView.tsx"), "utf8");
    expect(src).toContain("useEffectiveReducedMotion");
    expect(src).toContain('behavior: reducedMotion ? "auto" : "smooth"');
  });

  it("Inbox uses ExitCollapse and SegmentedControl/Button", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/inbox/InboxPanel.tsx"), "utf8");
    expect(src).toContain("ExitCollapse");
    expect(src).toContain("useExitPresenceList");
  });
});
