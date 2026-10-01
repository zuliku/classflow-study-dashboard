// @vitest-environment node
/**
 * Kiro Mini 常驻窗契约（源码锁定）：
 * 单运行时 + 主进程中继 —— Mini 是瘦客户端（?mini=1 同包渲染），真相在主窗口。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("Mini 协议（lib/ai/miniChat/protocol）", () => {
  it("wire 形状 + 上限 + ?mini=1 判定", () => {
    const src = read("lib/ai/miniChat/protocol.ts");
    expect(src).toContain("MINI_CHAT_PROTOCOL_VERSION");
    expect(src).toContain("buildMiniSnapshot");
    expect(src).toContain("sanitizeMiniSend");
    expect(src).toContain("isMiniModeSearch");
    expect(src).toContain("base64ToBytes");
    expect(src).toContain("bytesToBase64");
  });
});

describe("Main 侧（src/main/miniChat.ts + index.ts 接线）", () => {
  const src = read("src/main/miniChat.ts");
  const index = read("src/main/index.ts");

  it("窗口：frameless + alwaysOnTop + skipTaskbar + bounds 持久化 + 关闭只隐藏", () => {
    expect(src).toContain("frame: false");
    expect(src).toContain("alwaysOnTop");
    expect(src).toContain("skipTaskbar: true");
    expect(src).toContain("mini-chat-bounds.json");
    expect(src).toContain('event.preventDefault()');
    expect(src).toContain("?mini=1");
  });

  it("IPC 全集：show/hide/toggle/send/stop/publish-state/get-state/置顶 + send 回执关联", () => {
    for (const ch of [
      "mini:show",
      "mini:hide",
      "mini:toggle",
      "mini:send",
      "mini:stop",
      "mini:publish-state",
      "mini:get-state",
      "mini:set-always-on-top",
      "mini:is-always-on-top",
      "mini:remote-send",
      "mini:remote-send:done",
      "mini:remote-stop",
      "mini:state",
    ]) {
      expect(src, ch).toContain(ch);
    }
  });

  it("sender 校验 fail closed（id+URL 双门；send 必须来自 Mini 窗）", () => {
    expect(src).toContain("PERMISSION_DENIED");
    expect(src).toContain("isMiniWebContents(event.sender.id)");
    expect(src).toContain("isTrustedRendererUrl");
  });

  it("done 仅主窗口可回执；mini 窗与主窗同等导航硬化；不下发 capability", () => {
    expect(src).toContain("event.sender.id !== main.webContents.id");
    expect(src).toContain("setWindowOpenHandler");
    expect(src).toContain("will-navigate");
    expect(src).toContain("decideNavigation");
    expect(index).toContain('getApiCapability: () => ""');
  });

  it("index.ts 注册中继 + 信任 Mini 窗（同 launch 可信窗口）", () => {
    expect(index).toContain("registerMiniChatIpc");
    expect(index).toContain("isMiniWebContents(sender.id)");
  });
});

describe("Preload invoke 超时表（挂起不卡死 UI）", () => {
  const src = read("src/preload/index.ts");

  it("网络/长操作通道有超时（值 ≥ 内部上限 + 余量）", () => {
    for (const ch of [
      '"bridge:mcp:test": 60_000',
      '"bridge:mcp:callTool": 60_000',
      '"bridge:terminal:execute": 150_000',
      '"bridge:channels:test": 60_000',
      '"bridge:channels:startGmailOAuth": 200_000',
      '"mini:send": 120_000',
      '"bridge:computer:observe": 90_000',
    ]) {
      expect(src, ch).toContain(ch);
    }
    expect(src).toContain('code: "TIMEOUT"');
  });

  it("开原生对话框/后台长任务永不超时（用户思考时间无界）", () => {
    expect(src).not.toContain('"bridge:fs:pickDirectory":');
    expect(src).not.toContain('"bridge:skill:import":');
    expect(src).not.toContain('"bridge:channels:syncNow":');
  });
});

describe("Preload + 类型 + 访问器", () => {
  it("preload 暴露 mini 双向桥（主窗口侧 + Mini 侧）", () => {
    const src = read("src/preload/index.ts");
    expect(src).toContain("miniBridge");
    expect(src).toContain("mini:send");
    expect(src).toContain("mini:publish-state");
    expect(src).toContain("mini:state");
    expect(src).toContain("mini:remote-send");
    expect(src).toContain("mini:remote-stop");
  });

  it("types.ts：mini 为 optional capability；bridge.ts 有渐进检测", () => {
    expect(read("lib/desktop/types.ts")).toContain("ClassFlowDesktopMiniBridge");
    expect(read("lib/desktop/bridge.ts")).toContain("getClassFlowDesktopMiniBridge");
    expect(read("lib/desktop/bridge.ts")).toContain("hasClassFlowDesktopMini");
  });
});

describe("Renderer 接线", () => {
  it("main.tsx 按 ?mini=1 分支（Mini 无 TitleBar/App 运行时）", () => {
    const src = read("src/renderer/main.tsx");
    expect(src).toContain("isMiniModeSearch");
    expect(src).toContain("MiniChatApp");
  });

  it("Relay 宿主：Provider 持久根部单挂载；同一 chat.send + addFiles；sanitize 门 + 节流 publish", () => {
    const provider = read("components/kiro/KiroSessionProvider.tsx");
    expect(provider.match(/<MiniChatRelayHost \/>/g)?.length).toBe(1);
    const relay = read("components/kiro/mini/MiniChatRelayHost.tsx");
    expect(relay).toContain("chat.send");
    expect(relay).toContain("attachments.addFiles");
    expect(relay).toContain("sanitizeMiniSend");
    expect(relay).toContain("publishState");
    expect(relay).toContain("onRemoteSend");
    expect(relay).toContain("onRemoteStop");
    expect(relay).toContain("PUBLISH_THROTTLE_MS");
  });

  it("Mini App：拖动区 + 文件拖入 + 发送/停止 + 快照订阅", () => {
    const src = read("components/kiro/mini/MiniChatApp.tsx");
    expect(src).toContain("mini-drag-region");
    expect(src).toContain("mini-no-drag");
    expect(src).toContain("dataTransfer.files");
    expect(src).toContain("sendRemote");
    expect(src).toContain("stopRemote");
    expect(src).toContain("onState");
    expect(src).toContain("kiro-mini-app");
  });

  it("Sidecar 头部有弹出入口（桌面端才渲染）", () => {
    const src = read("components/kiro/sidecar/KiroSidecarShell.tsx");
    expect(src).toContain("kiro-sidecar-mini-popout");
    expect(src).toContain("MiniPopoutButton");
  });

  it("拖动区样式存在（frameless 原生拖动）", () => {
    const css = read("app/globals.css");
    expect(css).toContain(".mini-drag-region");
    expect(css).toContain("-webkit-app-region: drag");
    expect(css).toContain(".mini-no-drag");
  });
});
