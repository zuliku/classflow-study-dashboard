// @vitest-environment jsdom
/**
 * P5 — Desktop Session subscription ownership 测试（§54）。
 *
 * 覆盖：Host 是唯一订阅者（mount → subscribe 一次）；Sidecar open / minimize / close /
 * Workspace 切换（UI 生命周期）不新增订阅、不 unsubscribe；Provider unmount → unsubscribe；
 * session event → store 更新；terminal / blocked / session 切换 / 权限关闭 → preview 清理。
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComputerSessionHost } from "@/components/kiro/computer/KiroComputerSessionHost";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { useDesktopSessionPreviewStore } from "@/store/useDesktopSessionPreviewStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { FakeDesktopWorld, installFakeDesktopBridge } from "@/tests/helpers/fakeDesktopRuntime";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";
const SESSION_B = "cs-99999999-8888-7777-6666-555555555555";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useDesktopSessionStore.getState().clear();
  useDesktopSessionPreviewStore.getState().clearPreview();
  useKiroComputerStore.setState({ computerEnabled: true, desktopControlEnabled: true });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
  useDesktopSessionPreviewStore.getState().clearPreview();
  useKiroComputerStore.setState({ computerEnabled: false, desktopControlEnabled: false });
});

async function renderHost(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
}

function seedPreview(sessionId: string) {
  useDesktopSessionPreviewStore.getState().setPreview({
    sessionId,
    dataUrl: "data:image/jpeg;base64,AAAA",
    mimeType: "image/jpeg",
    width: 1280,
    height: 800,
    capturedAt: "2026-09-23T10:00:00.000Z",
    appName: "wechat",
    windowTitle: "微信",
    appProfileBlocked: false,
  });
}

describe("P5 Host — subscription ownership", () => {
  it("mount → subscribeSession 恰好一次；UI（Sidecar open/minimize/close）生命周期不影响订阅", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);

    await renderHost(
      <div>
        <KiroComputerSessionHost />
        <div data-testid="fake-sidecar" />
      </div>
    );
    expect(world.subscribeCalls).toBe(1);
    expect(world.listenerCount()).toBe(1);

    // Sidecar minimized（同级 UI 卸载；Host 保持同一位置）
    await act(async () => {
      root!.render(
        <div>
          <KiroComputerSessionHost />
        </div>
      );
    });
    expect(world.subscribeCalls).toBe(1);
    expect(world.unsubscribeCalls).toBe(0);
    expect(world.listenerCount()).toBe(1);

    // Sidecar closed → Workspace active（再次挂载其它 UI）
    await act(async () => {
      root!.render(
        <div>
          <KiroComputerSessionHost />
          <div data-testid="fake-workspace" />
        </div>
      );
    });
    expect(world.subscribeCalls).toBe(1);
    expect(world.unsubscribeCalls).toBe(0);
    expect(world.listenerCount()).toBe(1);
  });

  it("Provider unmount → unsubscribe；不重复 unsubscribe", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);
    expect(world.listenerCount()).toBe(1);

    await act(async () => {
      root!.unmount();
    });
    root = null;
    expect(world.unsubscribeCalls).toBe(1);
    expect(world.listenerCount()).toBe(0);
  });

  it("无 Desktop Runtime（无 bridge）→ 不订阅、不报错", async () => {
    await renderHost(<KiroComputerSessionHost />);
    expect(useDesktopSessionStore.getState().sessionId).toBeNull();
  });

  it("session event（真实 subscription 广播）→ store 正确更新（含 failureReason）", async () => {
    const world = new FakeDesktopWorld([
      { windowId: "win-1", title: "微信", appName: "wechat", elements: [] },
    ]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);

    // 触发真实 emit（fake world 的 emitSession 通过 listeners 广播）
    await act(async () => {
      await world.observe({ sessionId: SESSION });
    });

    const state = useDesktopSessionStore.getState();
    expect(state.sessionId).toBe(SESSION);
    expect(state.state).not.toBeNull();
    expect(state.appName).toBe("wechat");
  });
});

describe("P5 Host — preview 生命周期", () => {
  it("terminal state → 清理该 session 的 preview", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);

    seedPreview(SESSION);
    expect(useDesktopSessionPreviewStore.getState().preview).not.toBeNull();

    // 真实 subscription 广播（Host 是唯一监听者）
    await act(async () => {
      world.emitSessionForTest("completed", null, { sessionId: SESSION });
    });
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });

  it("受保护应用（blocked）→ 清理 preview", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);
    seedPreview(SESSION);

    await act(async () => {
      world.emitSessionForTest("acting", "click el-1", {
        sessionId: SESSION,
        appProfile: { id: "bank", label: "银行", blocked: true },
      });
    });
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });

  it("新 session 到达 → 旧 session preview 不保留", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);
    seedPreview(SESSION);

    await act(async () => {
      world.emitSessionForTest("observing", null, { sessionId: SESSION_B });
    });
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });

  it("旧 session 的 terminal 事件不清掉新 session 的 preview（sessionId 精确匹配）", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);
    seedPreview(SESSION_B);

    await act(async () => {
      world.emitSessionForTest("cancelled", null, { sessionId: SESSION });
    });
    expect(useDesktopSessionPreviewStore.getState().preview?.sessionId).toBe(SESSION_B);
  });

  it("Computer 权限关闭 → 清理 preview", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    await renderHost(<KiroComputerSessionHost />);
    seedPreview(SESSION);

    await act(async () => {
      useKiroComputerStore.setState({ computerEnabled: false });
    });
    expect(useDesktopSessionPreviewStore.getState().preview).toBeNull();
  });
});
