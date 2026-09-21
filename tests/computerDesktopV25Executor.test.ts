// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import {
  FakeDesktopWorld,
  installFakeDesktopBridge,
  type FakeElement,
} from "@/tests/helpers/fakeDesktopRuntime";

const NATIVE_WORKSPACE: KiroWorkspaceMeta = {
  id: "ws-1",
  name: "课程资料",
  roots: [{ id: "root-1", label: "资料", access: "read-write", adapterRef: "native:grant_test123" }],
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
};

const SANDBOX_WORKSPACE: KiroWorkspaceMeta = {
  ...NATIVE_WORKSPACE,
  roots: [{ id: "root-1", label: "内置", access: "read-write", adapterRef: "sandbox-default" }],
};

function snapshot(overrides: Partial<KiroComputerTurnSnapshot> = {}): KiroComputerTurnSnapshot {
  return {
    enabled: true,
    workspaceId: "ws-1",
    agentMode: "workspace-auto",
    roots: [{ id: "root-1", label: "资料", access: "read-write" }],
    desktopControlEnabled: true,
    desktopControlAvailable: true,
    desktopActionEnabled: true,
    desktopActionAvailable: true,
    desktopSessionId: "cs-11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

function runTool(
  toolName: string,
  toolInput: unknown,
  options: {
    snapshot?: KiroComputerTurnSnapshot;
    workspaces?: KiroWorkspaceMeta[];
    oneShotApprovals?: Array<{
      approvalId: string;
      toolCallId: string;
      capability: "ui.interact";
      workspaceId: string;
      fingerprint?: string;
    }>;
    toolCallId?: string;
  } = {}
) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: options.toolCallId ?? "call-1",
    toolInput,
    context: {
      turnSnapshot: options.snapshot ?? snapshot(),
      liveWorkspaces: options.workspaces ?? [NATIVE_WORKSPACE],
      livePermissionRules: [],
      taskId: "task-1",
    },
    counters: { readCount: 0, mutationCount: 0, terminalCount: 0 },
    oneShotApprovals: (options.oneShotApprovals ?? []) as never,
  });
}

const BUTTON: FakeElement = {
  elementId: "el-1",
  role: "Button",
  name: "确定",
  bounds: { x: 100, y: 100, width: 120, height: 40 },
};

afterEach(() => {
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

describe("V2.5 执行器 — 剪贴板门控", () => {
  it("设置未开启 → 直接拒绝（不调用 bridge）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);
    const attempt = await runTool("desktop_action", { action: "clipboard_read" });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(world.log.some((entry) => entry.tool === "action" || entry.tool === "prepareAction")).toBe(false);
  });

  it("设置开启 → sensitive 审批（deny / allow-once），批准后返回 clipboardText", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [BUTTON] },
    ]);
    world.clipboardText = "复制的内容";
    installFakeDesktopBridge(world);
    const enabled = snapshot({ desktopClipboardEnabled: true });

    const pending = await runTool("desktop_action", { action: "clipboard_read" }, { snapshot: enabled });
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.gui?.riskLevel).toBe("sensitive");
    expect(pending.request.allowedDecisions).toEqual(["deny", "allow-once"]);

    const approved = await runTool(
      "desktop_action",
      { action: "clipboard_read" },
      {
        snapshot: enabled,
        oneShotApprovals: [
          {
            approvalId: "approval-1",
            toolCallId: "call-1",
            capability: "ui.interact",
            workspaceId: "ws-1",
            fingerprint: pending.request.fingerprint,
          },
        ],
      }
    );
    expect(approved.kind).toBe("completed");
    if (approved.kind !== "completed" || !approved.output.ok) throw new Error("expected ok");
    expect((approved.output.data as { clipboardText?: string }).clipboardText).toBe("复制的内容");
  });

  it("clipboard_write 审批描述提示覆盖剪贴板", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);
    const pending = await runTool(
      "desktop_action",
      { action: "clipboard_write", clipboardText: "hello" },
      { snapshot: snapshot({ desktopClipboardEnabled: true }) }
    );
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.description).toContain("覆盖");
  });
});

describe("V2.5 执行器 — 文件上传", () => {
  const FILE_DIALOG_WINDOW = {
    windowId: "win-dialog",
    title: "打开",
    appName: "explorer",
    elements: [
      { elementId: "el-1", role: "Edit", name: "文件名(N):", bounds: { x: 100, y: 100, width: 300, height: 30 } },
      { elementId: "el-2", role: "Button", name: "打开(O)", bounds: { x: 420, y: 100, width: 80, height: 30 } },
    ],
  };

  it("本机工作区 + 文件对话框 → external 审批；批准后 fake 记录 grantId（无绝对路径）", async () => {
    const world = new FakeDesktopWorld([FILE_DIALOG_WINDOW]);
    installFakeDesktopBridge(world);
    const observe = await runTool("observe_desktop", {});
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const { observationId } = observe.output.data as { observationId: string };

    const pending = await runTool(
      "desktop_action",
      {
        action: "upload_file",
        observationId,
        file: { rootId: "root-1", path: "docs/报告.pdf" },
      }
    );
    expect(pending.kind).toBe("approval-required");
    if (pending.kind !== "approval-required") return;
    expect(pending.request.gui?.riskLevel).toBe("external");

    const approved = await runTool(
      "desktop_action",
      {
        action: "upload_file",
        observationId,
        file: { rootId: "root-1", path: "docs/报告.pdf" },
      },
      {
        oneShotApprovals: [
          {
            approvalId: "approval-1",
            toolCallId: "call-1",
            capability: "ui.interact",
            workspaceId: "ws-1",
            fingerprint: pending.request.fingerprint,
          },
        ],
      }
    );
    expect(approved.kind).toBe("completed");
    if (approved.kind !== "completed" || !approved.output.ok) throw new Error("expected ok");
    expect(world.uploadedFiles).toEqual([{ grantId: "grant_test123", path: "docs/报告.pdf" }]);
    const data = approved.output.data as { uploadedFile?: { rootId: string | null; path: string } };
    expect(data.uploadedFile).toEqual({ rootId: "root-1", path: "docs/报告.pdf" });
    expect(JSON.stringify(data)).not.toContain("grant_test123");
  });

  it("沙盒工作区（非本机）→ 拒绝", async () => {
    const world = new FakeDesktopWorld([FILE_DIALOG_WINDOW]);
    installFakeDesktopBridge(world);
    const observe = await runTool("observe_desktop", {}, { workspaces: [SANDBOX_WORKSPACE] });
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const { observationId } = observe.output.data as { observationId: string };

    const attempt = await runTool(
      "desktop_action",
      { action: "upload_file", observationId, file: { rootId: "root-1", path: "docs/报告.pdf" } },
      { workspaces: [SANDBOX_WORKSPACE] }
    );
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "PERMISSION_DENIED" } });
    expect(world.uploadedFiles).toHaveLength(0);
  });

  it("非文件对话框 → prepare 风险 blocked", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-chrome", title: "Google", appName: "chrome", elements: [BUTTON] },
    ]);
    installFakeDesktopBridge(world);
    const observe = await runTool("observe_desktop", {});
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const { observationId } = observe.output.data as { observationId: string };

    const attempt = await runTool("desktop_action", {
      action: "upload_file",
      observationId,
      file: { rootId: "root-1", path: "docs/报告.pdf" },
    });
    expect(attempt).toMatchObject({ kind: "completed", output: { ok: false, code: "ACTION_BLOCKED" } });
  });
});

describe("V2.5 执行器 — 拖拽审批指纹绑定落点", () => {
  it("同一 toolCallId 但落点不同 → 仍需新的确认", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-explorer",
        title: "下载",
        appName: "explorer",
        elements: [
          { elementId: "el-1", role: "ListItem", name: "文件 A", bounds: { x: 100, y: 100, width: 200, height: 40 } },
          { elementId: "el-2", role: "ListItem", name: "文件夹 B", bounds: { x: 400, y: 300, width: 200, height: 40 } },
          { elementId: "el-3", role: "ListItem", name: "文件夹 C", bounds: { x: 600, y: 500, width: 200, height: 40 } },
        ],
      },
    ]);
    installFakeDesktopBridge(world);
    const observe = await runTool("observe_desktop", {});
    if (observe.kind !== "completed" || !observe.output.ok) throw new Error("observe failed");
    const { observationId } = observe.output.data as { observationId: string };

    const first = await runTool("desktop_action", {
      action: "drag",
      observationId,
      target: { elementId: "el-1" },
      to: { elementId: "el-2" },
    });
    expect(first.kind).toBe("approval-required");
    if (first.kind !== "approval-required") return;

    const reused = await runTool(
      "desktop_action",
      { action: "drag", observationId, target: { elementId: "el-1" }, to: { elementId: "el-3" } },
      {
        oneShotApprovals: [
          {
            approvalId: "approval-1",
            toolCallId: "call-1",
            capability: "ui.interact",
            workspaceId: "ws-1",
            fingerprint: first.request.fingerprint,
          },
        ],
      }
    );
    expect(reused.kind).toBe("approval-required");
  });
});
