// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Phase3 Workspace Polish", () => {
  it("Composer progressive disclosure: Reasoning only when Computer enabled", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
    expect(src).toContain("computerEnabled && reasoningCapability");
    expect(src).toContain("computerEnabled && agentMode");
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
