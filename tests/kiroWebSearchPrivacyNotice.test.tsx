// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WebSearchPrivacyNotice } from "@/components/kiro/WebSearchPrivacyNotice";
import { hasUsedWebSearch } from "@/lib/ai/web/privacyNotice";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

describe("web search first-use privacy notice", () => {
  beforeEach(() => {
    cleanup();
    useKiroPreferencesStore.setState({
      webSearchPrivacyNoticeSeen: false,
      webSearchCredentialRef: "",
    });
  });

  it("hasUsedWebSearch 认真实 web_search / web_research part，不认正文或 read", () => {
    expect(
      hasUsedWebSearch([
        { role: "assistant", parts: [{ type: "text", text: "web_search 可用" }] },
      ])
    ).toBe(false);
    expect(
      hasUsedWebSearch([
        { role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "s1" }] },
      ])
    ).toBe(true);
    expect(
      hasUsedWebSearch([
        { role: "assistant", parts: [{ type: "tool-web_research", toolCallId: "rs1" }] },
      ])
    ).toBe(true);
    expect(
      hasUsedWebSearch([
        { role: "assistant", parts: [{ type: "tool-read_web_source", toolCallId: "r1" }] },
      ])
    ).toBe(false);
  });

  it("提示条文案与「知道了」dismiss", () => {
    const onDismiss = vi.fn();
    render(<WebSearchPrivacyNotice onDismiss={onDismiss} />);
    expect(screen.getByTestId("web-search-privacy-notice")).toBeTruthy();
    expect(screen.getByText(/第三方搜索服务/)).toBeTruthy();
    fireEvent.click(screen.getByText("知道了"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Conversation surface 在真实 web_search 后挂载一次性提示", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/kiro/KiroChatSurface.tsx", "utf8");
    expect(source).toContain("WebSearchPrivacyNotice");
    expect(source).toContain("hasUsedWebSearch(chat.messages)");
    expect(source).toContain("webSearchPrivacyNoticeSeen");
  });

  it("seen 持久化；全局 reset 重置 seen 但不丢 credentialRef", () => {
    const store = useKiroPreferencesStore.getState();
    store.setWebSearchCredentialRef("cred_test_ref");
    store.setWebSearchPrivacyNoticeSeen(true);
    expect(useKiroPreferencesStore.getState().webSearchPrivacyNoticeSeen).toBe(true);
    expect(useKiroPreferencesStore.getState().webSearchCredentialRef).toBe("cred_test_ref");

    const raw = localStorage.getItem("classflow-kiro-preferences-v1") ?? "";
    expect(raw).toContain("cred_test_ref");
    expect(raw).not.toContain("tvly-secret");

    useKiroPreferencesStore.getState().resetToDefaults();
    expect(useKiroPreferencesStore.getState().webSearchPrivacyNoticeSeen).toBe(false);
    expect(useKiroPreferencesStore.getState().webSearchCredentialRef).toBe("cred_test_ref");
  });
});
