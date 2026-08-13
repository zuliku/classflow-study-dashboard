import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import type { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import {
  DEFAULT_SANDBOX_ADAPTER_REF,
  adapterRefStillReferenced,
  isDefaultSandboxWorkspace,
} from "@/lib/ai/computer/workspace/management";
import { clearSandboxAdapter, sandboxWriteText, sandboxListDirectory } from "@/lib/ai/computer/adapters/sandbox";
import { forgetBrowserWorkspaceGrant, getBrowserWorkspaceDirectoryHandle } from "@/lib/ai/computer/workspace/grants";

const makeWorkspace = (id: string, adapterRef: string): KiroWorkspaceMeta => ({
  id,
  name: id,
  roots: [
    {
      id: `${id}-root`,
      label: id,
      access: "read-write",
      adapterRef,
    },
  ],
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
});

async function clearAllSandbox() {
  await clearSandboxAdapter(DEFAULT_SANDBOX_ADAPTER_REF);
  await clearSandboxAdapter("sandbox-other");
  await forgetBrowserWorkspaceGrant("browser-grant-test");
}

beforeEach(async () => {
  await clearAllSandbox();
});

describe("workspace management helpers", () => {
  it("detects only the canonical default Sandbox", () => {
    expect(
      isDefaultSandboxWorkspace(makeWorkspace("sandbox", DEFAULT_SANDBOX_ADAPTER_REF))
    ).toBe(true);
    expect(isDefaultSandboxWorkspace(makeWorkspace("browser", "browser-grant-1"))).toBe(false);
    // 非 canonical sandbox adapter（其它沙箱命名空间）不算默认 Sandbox
    expect(isDefaultSandboxWorkspace(makeWorkspace("custom", "sandbox-custom"))).toBe(false);
  });

  it("detects shared adapter references", () => {
    const a = makeWorkspace("a", "shared");
    const b = makeWorkspace("b", "shared");
    const c = makeWorkspace("c", "unique");

    expect(adapterRefStillReferenced([a, b, c], "shared")).toBe(true);
    expect(adapterRefStillReferenced([a, b], "unique")).toBe(false);
    expect(adapterRefStillReferenced([a, b], "shared")).toBe(true);
  });
});

describe("sandbox namespace cleanup", () => {
  it("clearSandboxAdapter 只清该 adapterRef namespace，不影响其它 adapter", async () => {
    await sandboxWriteText(DEFAULT_SANDBOX_ADAPTER_REF, "a.md", "A");
    await sandboxWriteText(DEFAULT_SANDBOX_ADAPTER_REF, "sub/b.md", "B");
    await sandboxWriteText("sandbox-other", "keep.md", "KEEP");

    await clearSandboxAdapter(DEFAULT_SANDBOX_ADAPTER_REF);

    expect(await sandboxListDirectory(DEFAULT_SANDBOX_ADAPTER_REF, "")).toHaveLength(0);
    // 其它 adapter 不受影响
    expect(await sandboxListDirectory("sandbox-other", "")).toHaveLength(1);
  });
});

describe("browser grant forgetting", () => {
  it("forgetBrowserWorkspaceGrant 只删授权记录（handle 记录），不触碰真实文件夹", async () => {
    // 无真实 File System Access 环境：验证 helper 对缺失记录安全 + 可重复调用
    await forgetBrowserWorkspaceGrant("browser-grant-test");
    await forgetBrowserWorkspaceGrant("browser-grant-test");
    expect(await getBrowserWorkspaceDirectoryHandle("browser-grant-test")).toBeNull();
  });
});
