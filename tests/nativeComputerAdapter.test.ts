// @vitest-environment jsdom
/**
 * Native V1：Native Adapter（ComputerAdapterIO via Desktop Bridge mock）+ workspace 授权生命周期。
 * - 每次 IO 重新 resolve bridge + live grant 检查（撤销后 0 IO）
 * - 错误规范化（绝不透传 bridge 原始异常）
 * - runtime missing（桌面版 workspace 在普通浏览器打开）→ 明确失败，不 fallback
 * - forget grant：文件保留，只删映射
 * - factory 三路路由 + legacy browser 兼容
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/adapters/factory";
import { ComputerError } from "@/lib/ai/computer/errors";
import { forgetNativeGrant } from "@/lib/ai/computer/adapters/native";
import {
  authorizeNativeWorkspaceFolder,
  resolveWorkspaceRootAvailability,
  reauthorizeNativeWorkspaceRoot,
} from "@/lib/ai/computer/workspace/native";
import { installMemoryDesktopBridgeMock } from "@/tests/helpers/memoryDesktopBridge";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";

type Control = {
  calls: Record<string, number>;
  files: Map<string, unknown>;
  grants: Map<string, unknown>;
  revokeGrant: (g: string) => void;
  cancelNextPick: () => void;
  resetCancel: () => void;
  uninstall: () => void;
  opCount: (op: string) => number;
  fileExists: (g: string, p: string) => boolean;
};

let ctl: Control;

beforeEach(async () => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
  installMemoryDesktopBridgeMock();
  ctl = (window as unknown as { __desktopBridgeControl: Control }).__desktopBridgeControl;
  // 预授权 grant_mock_1（mock 的 grant 由 pickDirectory 生成）
  await (window.classflowDesktop as { filesystem: { pickDirectory: (i: { access: string }) => Promise<unknown> } }).filesystem.pickDirectory({ access: "read-write" });
  // 重置 computer store（避免跨用例污染）
  useKiroComputerStore.setState({ workspaces: [], activeWorkspaceId: null, computerEnabled: false, agentMode: "guided", permissionRules: [] });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
});

describe("Native Adapter IO（factory 路由 + memory bridge）", () => {
  const REF = "native:grant_mock_1";

  it("完整 roundtrip：createDirectory / writeText / list / readText / readTextPrefix / stat / writeBytes / readBytes / move / remove", async () => {
    const io = getComputerAdapterForAdapterRef(REF);
    expect(await io.createDirectory("论文")).toBe("created");
    await io.writeText("论文/outline.md", "# 大纲\n- 第一章", "text/markdown");
    const list = await io.list("论文");
    expect(list).toEqual([{ name: "outline.md", kind: "file", size: Buffer.byteLength("# 大纲\n- 第一章") }]);
    expect(await io.readText("论文/outline.md")).toBe("# 大纲\n- 第一章");
    const prefix = await io.readTextPrefix("论文/outline.md", 6);
    expect(prefix.truncated).toBe(true);
    expect(prefix.text.length).toBeGreaterThan(0);
    const stat = await io.stat("论文/outline.md");
    expect(stat?.kind).toBe("file");
    await io.writeBytes("论文/raw.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
    const bytes = await io.readBytes("论文/raw.bin");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    await io.move("论文/outline.md", "outline.md");
    expect(await io.readText("outline.md")).toBe("# 大纲\n- 第一章");
    await io.remove("outline.md", "file");
    expect(await io.stat("outline.md")).toBeNull();
  });

  it("grant 缺失 → 授权错误（不伪装成文件不存在）", async () => {
    const io = getComputerAdapterForAdapterRef("native:grant_ghost");
    await expect(io.readText("a.txt")).rejects.toThrowError(/重新授权/);
    await expect(io.readText("a.txt")).rejects.toMatchObject({ code: "WORKSPACE_PERMISSION_REQUIRED" });
  });

  it("运行时撤销 grant（mid-session）→ 下一次 IO 立即失败，且真实 IO 调用为 0", async () => {
    const io = getComputerAdapterForAdapterRef(REF);
    await io.writeText("a.txt", "v1");
    const before = ctl.opCount("writeText");
    ctl.revokeGrant("grant_mock_1");
    await expect(io.writeText("a.txt", "v2")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(ctl.opCount("writeText")).toBe(before); // 撤销后没有发生真实写入
    // read 同样拒绝
    await expect(io.readText("a.txt")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("runtime missing（bridge 卸载）→ 明确失败「仅可在桌面版访问」，不 fallback browser", async () => {
    const io = getComputerAdapterForAdapterRef(REF);
    ctl.uninstall();
    await expect(io.readText("a.txt")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(io.readText("a.txt")).rejects.toThrowError(/仅可在桌面版访问/);
  });

  it("错误规范化：NOT_FOUND / ALREADY_EXISTS / PERMISSION_DENIED / DIRECTORY_NOT_EMPTY → ComputerError", async () => {
    const io = getComputerAdapterForAdapterRef(REF);
    await expect(io.readText("nope.txt")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await io.writeText("x.txt", "1");
    await expect(io.writeText("x.txt", "2")).resolves.toBeUndefined(); // bridge write 覆盖语义
    // move 到已存在目标 → ALREADY_EXISTS
    await io.writeText("y.txt", "2");
    await expect(io.move("x.txt", "y.txt")).rejects.toMatchObject({ code: "RESOURCE_ALREADY_EXISTS" });
    // 非空目录删除 → DIRECTORY_NOT_EMPTY → VERIFICATION_FAILED
    await io.createDirectory("d1");
    await io.writeText("d1/f.txt", "1");
    await expect(io.remove("d1", "directory")).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    // PERMISSION_DENIED
    ctl.revokeGrant("grant_mock_1");
    await expect(io.readText("x.txt")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("bridge 抛非结构化异常 → 也映射为 ComputerError（不把原始异常传给模型）", async () => {
    // 构造不完整/异常 bridge：方法直接 throw 原始错误
    const broken = {
      version: 1,
      platform: "windows",
      filesystem: {
        pickDirectory: async () => null,
        getGrantStatus: async () => ({ status: "granted" }),
        forgetGrant: async () => {},
        list: async () => {
          throw new Error("EPERM raw");
        },
        stat: async () => null,
        readText: async () => {
          throw "string error";
        },
        readTextPrefix: async () => ({ text: "", truncated: false }),
        createDirectory: async () => "created",
        writeText: async () => {},
        writeBytes: async () => {},
        remove: async () => {},
        move: async () => {},
      },
    };
    (window as unknown as Record<string, unknown>).classflowDesktop = broken;
    const io = getComputerAdapterForAdapterRef("native:g_ok");
    const err = await io.list(".").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComputerError);
    expect((err as ComputerError).code).toBe("VERIFICATION_FAILED");
    expect(String((err as Error).message)).not.toContain("EPERM");
  });

  it("factory 路由：native 前缀 → native；sandbox 前缀 → sandbox；legacy 无前缀 → browser（不破坏历史）", () => {
    const nativeIO = getComputerAdapterForAdapterRef("native:grant_mock_1");
    const sandboxIO = getComputerAdapterForAdapterRef("sandbox-default");
    const legacyIO = getComputerAdapterForAdapterRef("browser-grant-legacy-1");
    // 构造时不抛错；native 走 bridge（撤销后 fail），sandbox 走 IndexedDB（jsdom fake-indexeddb 可用）
    expect(typeof nativeIO.readText).toBe("function");
    expect(typeof sandboxIO.readText).toBe("function");
    expect(typeof legacyIO.readText).toBe("function");
  });
});

describe("forgetNativeGrant", () => {
  it("只删授权映射，真实文件保留", async () => {
    const io = getComputerAdapterForAdapterRef("native:grant_mock_1");
    await io.writeText("keep.txt", "内容");
    expect(ctl.fileExists("grant_mock_1", "keep.txt")).toBe(true);
    await forgetNativeGrant("native:grant_mock_1");
    expect(ctl.opCount("forgetGrant")).toBe(1);
    expect(ctl.fileExists("grant_mock_1", "keep.txt")).toBe(true); // 文件仍在
    expect(ctl.grants.has("grant_mock_1")).toBe(false); // 映射已删
  });

  it("bridge 缺失 → no-op（web 侧没有可忘的映射）", async () => {
    ctl.uninstall();
    await forgetNativeGrant("native:grant_mock_1"); // 不抛错
  });

  it("非 native adapterRef → no-op", async () => {
    await forgetNativeGrant("browser-grant-x");
    expect(ctl.opCount("forgetGrant")).toBe(0);
  });
});

describe("resolveWorkspaceRootAvailability", () => {
  it("native granted → available；denied → permission-required；missing → missing-grant", async () => {
    const root = (ref: string) => ({ id: "r", label: "x", access: "read-write" as const, adapterRef: ref });
    expect(await resolveWorkspaceRootAvailability(root("native:grant_mock_1"))).toBe("available");
    ctl.revokeGrant("grant_mock_1");
    expect(await resolveWorkspaceRootAvailability(root("native:grant_mock_1"))).toBe("permission-required");
    expect(await resolveWorkspaceRootAvailability(root("native:grant_ghost"))).toBe("missing-grant");
  });

  it("bridge 缺失 → runtime-unavailable（桌面版 workspace 在普通浏览器打开）", async () => {
    ctl.uninstall();
    expect(
      await resolveWorkspaceRootAvailability({ id: "r", label: "x", access: "read-write", adapterRef: "native:grant_mock_1" })
    ).toBe("runtime-unavailable");
  });

  it("sandbox → available；非法 native ref → missing-grant", async () => {
    expect(
      await resolveWorkspaceRootAvailability({ id: "r", label: "x", access: "read-write", adapterRef: "sandbox-default" })
    ).toBe("available");
    expect(
      await resolveWorkspaceRootAvailability({ id: "r", label: "x", access: "read-write", adapterRef: "native:C:\\bad" })
    ).toBe("missing-grant");
  });
});

describe("authorizeNativeWorkspaceFolder", () => {
  it("授权成功 → 创建 workspace（native:<grantId>）+ active + enabled；模型可见层只有 label/access", async () => {
    const ws = await authorizeNativeWorkspaceFolder();
    expect(ws).not.toBeNull();
    expect(ws?.name).toBe("论文资料");
    expect(ws?.roots[0].adapterRef).toMatch(/^native:grant_mock_\d+$/);
    const store = useKiroComputerStore.getState();
    expect(store.workspaces.some((w) => w.id === ws?.id)).toBe(true);
    expect(store.activeWorkspaceId).toBe(ws?.id);
    expect(store.computerEnabled).toBe(true);
    // 持久化元数据不含绝对路径 / 平台信息
    expect(JSON.stringify(ws)).not.toContain("C:\\");
    expect(JSON.stringify(ws)).not.toContain("windows");
  });

  it("用户取消 → null，不创建 workspace", async () => {
    ctl.cancelNextPick();
    const ws = await authorizeNativeWorkspaceFolder();
    expect(ws).toBeNull();
    expect(useKiroComputerStore.getState().workspaces).toHaveLength(0);
  });

  it("bridge 非法 grantId → 拒绝创建", async () => {
    // 篡改 mock：pickDirectory 返回非法 grantId
    const bridge = window.classflowDesktop as {
      filesystem: { pickDirectory: (i: unknown) => Promise<unknown> };
    };
    bridge.filesystem.pickDirectory = async () => ({
      grantId: "C:\\Users\\evil",
      displayName: "evil",
      access: "read-write",
    });
    const ws = await authorizeNativeWorkspaceFolder();
    expect(ws).toBeNull();
    expect(useKiroComputerStore.getState().workspaces).toHaveLength(0);
  });
});

describe("reauthorizeNativeWorkspaceRoot", () => {
  it("重新授权 → 新 grant 替换 adapterRef；取消 → 原授权不变", async () => {
    const ws = await authorizeNativeWorkspaceFolder();
    expect(ws).not.toBeNull();
    const oldRef = ws!.roots[0].adapterRef;

    const next = await reauthorizeNativeWorkspaceRoot(ws!, ws!.roots[0].id);
    expect(next).not.toBeNull();
    expect(next!.roots[0].adapterRef).not.toBe(oldRef);
    expect(next!.roots[0].adapterRef).toMatch(/^native:grant_mock_\d+$/);
    const stored = useKiroComputerStore.getState().workspaces.find((w) => w.id === ws!.id);
    expect(stored?.roots[0].adapterRef).toBe(next!.roots[0].adapterRef);

    ctl.cancelNextPick();
    const unchanged = await reauthorizeNativeWorkspaceRoot(ws!, ws!.roots[0].id);
    expect(unchanged).toBeNull();
    expect(
      useKiroComputerStore.getState().workspaces.find((w) => w.id === ws!.id)?.roots[0].adapterRef
    ).toBe(next!.roots[0].adapterRef);
  });
});

describe("nativeAdapterCapabilities", () => {
  it("kind=native；nativeWorkspace=true；open/reveal 恒 false", async () => {
    const { nativeAdapterCapabilities } = await import("@/lib/ai/computer/adapters/native");
    const caps = nativeAdapterCapabilities();
    expect(caps.kind).toBe("native");
    expect(caps.nativeWorkspace).toBe(true);
    expect(caps.canRead).toBe(true);
    expect(caps.canWrite).toBe(true);
    expect(caps.canOpenNativeFile).toBe(false);
    expect(caps.canRevealNativeFile).toBe(false);
  });
});

describe("浏览器侧行为：bridge 不影响既有 sandbox/browser 路径", () => {
  it("sandbox adapter 仍可用（bridge 卸载状态下）", async () => {
    ctl.uninstall();
    const io = getComputerAdapterForAdapterRef("sandbox-default");
    await io.writeText("s.txt", "沙箱内容");
    expect(await io.readText("s.txt")).toBe("沙箱内容");
    vi.restoreAllMocks();
  });
});
