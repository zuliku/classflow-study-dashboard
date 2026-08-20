// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// Polyfill ResizeObserver & matchMedia (jsdom)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
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
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

// Mock inbox store
const inboxState = vi.hoisted(() => ({
  items: [
    {
      id: "item-1",
      source: "qq-bot" as const,
      senderDisplay: "Alice",
      text: "课程通知：作业 DDL 明天",
      subject: "作业通知",
      receivedAt: Date.now(),
      status: "unread" as const,
      replyContextId: "ctx-1",
      conversationId: "conv-1",
      sourceAccountId: "acc-1",
      attachments: [],
    },
  ] as unknown[],
  updateStatus: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@/store/useInboxStore", () => ({
  useInboxStore: (selector: (s: unknown) => unknown) => selector(inboxState),
}));

// Mock QQReplyDialog to simplify nested test
vi.mock("@/components/inbox/QQReplyDialog", () => ({
  QQReplyDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void; item: unknown }) => {
    if (!open) return null;
    return (
      <div data-testid="mock-qq-reply">
        <button onClick={() => onOpenChange(false)}>close reply</button>
      </div>
    );
  },
}));

import { InboxPanel } from "@/components/inbox/InboxPanel";
import { clearOverlayStack } from "@/lib/overlayStack";

describe("InboxPanel Lifecycle — Task 16B K", () => {
  beforeEach(() => {
    cleanup();
    clearOverlayStack();
    inboxState.updateStatus.mockClear();
    inboxState.removeItem.mockClear();
    // Ensure items present
    inboxState.items = [
      {
        id: "item-1",
        source: "qq-bot" as const,
        senderDisplay: "Alice",
        text: "课程通知：作业 DDL 明天",
        subject: "作业通知",
        receivedAt: Date.now(),
        status: "unread" as const,
        replyContextId: "ctx-1",
        conversationId: "conv-1",
        sourceAccountId: "acc-1",
        attachments: [],
      },
    ] as unknown[];
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    clearOverlayStack();
  });

  it("open Inbox → X visible → click X → onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    render(<InboxPanel open={true} onOpenChange={onOpenChange} />);
    const closeBtn = screen.getByLabelText("关闭收件箱");
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.getAttribute("data-testid")).toBe("inbox-close-button");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("open Inbox → Escape → close", async () => {
    const onOpenChange = vi.fn();
    render(<InboxPanel open={true} onOpenChange={onOpenChange} />);
    // InboxPanel is topmost, Escape should trigger onOpenChange false
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("open Detail → Escape → Detail close → Inbox remains open", async () => {
    const onOpenChange = vi.fn();
    const { container } = render(<InboxPanel open={true} onOpenChange={onOpenChange} />);
    // Open detail by clicking 查看
    const viewBtn = screen.getByTestId("inbox-view-item-1");
    fireEvent.click(viewBtn);
    // Detail dialog should be visible
    expect(screen.getByText("EXTERNAL UNTRUSTED CONTENT")).toBeTruthy();
    // Escape should close detail only, not root
    fireEvent.keyDown(window, { key: "Escape" });
    // Detail should be gone, but root onOpenChange not called (since topmost was detail)
    // The detail's onOpenChange sets selected null, not calling root's onOpenChange
    // So root onOpenChange should not have been called with false
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Detail content should be removed
    expect(screen.queryByText("EXTERNAL UNTRUSTED CONTENT")).toBeNull();
    // Root inbox should still be in DOM (check header)
    expect(screen.getByText("收件箱")).toBeTruthy();
  });

  it("open QQ Reply → close reply → Inbox still usable", async () => {
    const onOpenChange = vi.fn();
    render(<InboxPanel open={true} onOpenChange={onOpenChange} />);
    const replyBtn = screen.getByTestId("inbox-reply-item-1");
    fireEvent.click(replyBtn);
    expect(screen.getByTestId("mock-qq-reply")).toBeTruthy();
    // Close reply via its button
    fireEvent.click(screen.getByText("close reply"));
    expect(screen.queryByTestId("mock-qq-reply")).toBeNull();
    // Inbox should still be open and usable (e.g., filter still visible)
    expect(screen.getByTestId("inbox-filter-unread")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("close root Inbox clears selected/reply state (reopen does not restore old overlay)", async () => {
    const Wrapper = () => {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <InboxPanel open={open} onOpenChange={setOpen} />
          <button onClick={() => setOpen(true)}>reopen</button>
          <span data-testid="open-state">{open ? "open" : "closed"}</span>
        </>
      );
    };
    render(<Wrapper />);
    // Open detail
    fireEvent.click(screen.getByTestId("inbox-view-item-1"));
    expect(screen.getByText("EXTERNAL UNTRUSTED CONTENT")).toBeTruthy();
    // Close root via X
    fireEvent.click(screen.getByLabelText("关闭收件箱"));
    // Should have cleared selected; detail should be gone
    expect(screen.queryByText("EXTERNAL UNTRUSTED CONTENT")).toBeNull();
    expect(screen.getByTestId("open-state").textContent).toBe("closed");
    // Reopen
    fireEvent.click(screen.getByText("reopen"));
    expect(screen.getByTestId("open-state").textContent).toBe("open");
    // Detail should not automatically reappear
    expect(screen.queryByText("EXTERNAL UNTRUSTED CONTENT")).toBeNull();
    // QQ reply also not reappear
    expect(screen.queryByTestId("mock-qq-reply")).toBeNull();
  });

  it("Inbox trigger not in Kiro chat vertical body", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const content = fs.readFileSync(path.join(process.cwd(), "components/kiro/KiroWorkspace.tsx"), "utf-8");
    expect(content).not.toContain("kiro-inbox-button");
    // KiroWorkspace should not contain 收件箱 trigger after move to header
    expect(content).not.toContain("收件箱");
    // Old inbox row with justify-end gap-2 should be removed (not just any pb-2)
    expect(content).not.toContain("justify-end gap-2 pb-2");
    expect(content).not.toContain("InboxPanel");
    // Verify WorkspaceInboxButton exists and is used in page.tsx
    const pageContent = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf-8");
    expect(pageContent).toContain("WorkspaceInboxButton");
    const inboxButtonContent = fs.readFileSync(path.join(process.cwd(), "components/layout/WorkspaceInboxButton.tsx"), "utf-8");
    expect(inboxButtonContent).toContain("workspace-inbox-button");
  });

  it("WorkspaceInboxButton grouped with search in same flex container", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const headerContent = fs.readFileSync(path.join(process.cwd(), "components/layout/WorkspaceHeader.tsx"), "utf-8");
    // Header should have flex shrink-0 items-center gap containing actions and search
    expect(headerContent).toContain("flex shrink-0 items-center");
    const pageContent = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf-8");
    // In page.tsx, WorkspaceHeader actions should contain WorkspaceInboxButton
    expect(pageContent).toMatch(/WorkspaceHeader[\s\S]*WorkspaceInboxButton/);
    // WorkspaceInboxButton component should exist and have correct aria-label
    const inboxButtonContent = fs.readFileSync(path.join(process.cwd(), "components/layout/WorkspaceInboxButton.tsx"), "utf-8");
    expect(inboxButtonContent).toContain("aria-label");
    expect(inboxButtonContent).toContain("workspace-inbox-button");
  });
});
