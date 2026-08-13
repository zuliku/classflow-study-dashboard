import { describe, it, expect, beforeEach } from "vitest";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";

/** 独立实例化 store（避免跨测试共享状态） */
function freshStore() {
  useKiroComputerStore.setState({
    computerEnabled: false,
    activeWorkspaceId: null,
    agentMode: "guided",
    workspaces: [],
    permissionRules: [],
  });
  return useKiroComputerStore;
}

const ws = (id: string, name: string): KiroWorkspaceMeta => ({
  id,
  name,
  roots: [
    { id: `${id}-root`, label: "输出", access: "read-write", adapterRef: `ref-${id}` },
  ],
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
});

describe("useKiroComputerStore", () => {
  beforeEach(() => {
    freshStore();
  });

  it("defaults：computerEnabled=false / agentMode=guided / 无 active workspace", () => {
    const s = useKiroComputerStore.getState();
    expect(s.computerEnabled).toBe(false);
    expect(s.agentMode).toBe("guided");
    expect(s.activeWorkspaceId).toBeNull();
    expect(s.workspaces).toEqual([]);
    expect(s.permissionRules).toEqual([]);
  });

  it("setComputerEnabled(true) 不自动发明 workspace", () => {
    useKiroComputerStore.getState().setComputerEnabled(true);
    expect(useKiroComputerStore.getState().computerEnabled).toBe(true);
    expect(useKiroComputerStore.getState().workspaces).toEqual([]);
    expect(useKiroComputerStore.getState().activeWorkspaceId).toBeNull();
  });

  it("workspace add/update/remove", () => {
    const s = useKiroComputerStore.getState();
    s.addWorkspace(ws("research", "论文研究"));
    expect(useKiroComputerStore.getState().workspaces).toHaveLength(1);

    useKiroComputerStore.getState().updateWorkspace("research", { name: "论文研究 V2" });
    expect(useKiroComputerStore.getState().workspaces[0].name).toBe("论文研究 V2");

    useKiroComputerStore.getState().removeWorkspace("research");
    expect(useKiroComputerStore.getState().workspaces).toHaveLength(0);
  });

  it("删除 active workspace 清除选择", () => {
    const s = useKiroComputerStore.getState();
    s.addWorkspace(ws("research", "论文研究"));
    s.setActiveWorkspaceId("research");
    expect(useKiroComputerStore.getState().activeWorkspaceId).toBe("research");

    useKiroComputerStore.getState().removeWorkspace("research");
    expect(useKiroComputerStore.getState().activeWorkspaceId).toBeNull();
  });

  it("agentMode 变化不影响 workspaces / roots", () => {
    const s = useKiroComputerStore.getState();
    s.addWorkspace(ws("research", "论文研究"));
    s.setAgentMode("plan");
    expect(useKiroComputerStore.getState().workspaces[0].roots).toHaveLength(1);
    expect(useKiroComputerStore.getState().workspaces[0].roots[0].access).toBe("read-write");
  });

  it("persistent rule upsert/remove；session rule 不持久化", () => {
    const s = useKiroComputerStore.getState();
    const persistent: ComputerPermissionRule = {
      id: "p1",
      effect: "deny",
      capability: "fs.delete",
      scope: "persistent",
    };
    const session: ComputerPermissionRule = {
      id: "s1",
      effect: "allow",
      capability: "fs.modify",
      scope: "session",
    };
    s.upsertPermissionRule(persistent);
    s.upsertPermissionRule(session);
    expect(useKiroComputerStore.getState().permissionRules).toHaveLength(2);

    // partialize 只含 persistent
    const persisted = useKiroComputerStore.persist.getOptions().partialize?.(
      useKiroComputerStore.getState()
    ) as { permissionRules?: ComputerPermissionRule[] };
    expect(persisted.permissionRules?.map((r) => r.id)).toEqual(["p1"]);
    expect(persisted.permissionRules?.some((r) => r.scope === "session")).toBe(false);

    useKiroComputerStore.getState().removePermissionRule("p1");
    expect(
      useKiroComputerStore.getState().permissionRules.some((r) => r.id === "p1")
    ).toBe(false);
  });

  it("持久化 JSON 不含 native handle / native path", () => {
    const s = useKiroComputerStore.getState();
    s.addWorkspace({
      ...ws("research", "论文研究"),
      roots: [
        { id: "r1", label: "输出", access: "read-write", adapterRef: "opaque-ref-1" },
      ],
    });
    const persisted = JSON.stringify(
      useKiroComputerStore.persist.getOptions().partialize?.(useKiroComputerStore.getState())
    );
    expect(persisted).not.toContain("C:\\");
    expect(persisted).not.toContain("showDirectoryPicker");
    expect(persisted).not.toContain("FileSystemDirectoryHandle");
    // adapterRef 是 opaque key，不是 native path
    expect(persisted).toContain("opaque-ref-1");
  });

  it("ensureDefaultSandboxWorkspace reuses one canonical Sandbox", () => {
    const first = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
    const second = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();

    expect(second).toBe(first);
    const state = useKiroComputerStore.getState();
    expect(state.activeWorkspaceId).toBe(first);
    expect(state.computerEnabled).toBe(true);
    expect(
      state.workspaces.filter((w) =>
        w.roots.some((r) => r.adapterRef === "sandbox-default")
      )
    ).toHaveLength(1);
  });

  it("removing active Workspace selects next remaining Workspace", () => {
    const store = useKiroComputerStore.getState();
    store.addWorkspace(ws("a", "A"));
    store.addWorkspace(ws("b", "B"));
    store.setActiveWorkspaceId("a");
    store.setComputerEnabled(true);

    useKiroComputerStore.getState().removeWorkspace("a");

    const state = useKiroComputerStore.getState();
    expect(state.activeWorkspaceId).toBe("b");
    expect(state.computerEnabled).toBe(true);
  });

  it("removing last Workspace disables Computer Agent", () => {
    const store = useKiroComputerStore.getState();
    store.addWorkspace(ws("only", "Only"));
    store.setActiveWorkspaceId("only");
    store.setComputerEnabled(true);

    useKiroComputerStore.getState().removeWorkspace("only");

    const state = useKiroComputerStore.getState();
    expect(state.workspaces).toEqual([]);
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.computerEnabled).toBe(false);
  });

  it("removing Workspace removes only permission rules scoped to it", () => {
    const store = useKiroComputerStore.getState();
    store.addWorkspace(ws("a", "A"));
    store.addWorkspace(ws("b", "B"));
    store.upsertPermissionRule({
      id: "a-persistent",
      effect: "allow",
      capability: "fs.modify",
      workspaceId: "a",
      scope: "persistent",
    });
    store.upsertPermissionRule({
      id: "a-session",
      effect: "allow",
      capability: "fs.modify",
      workspaceId: "a",
      scope: "session",
    });
    store.upsertPermissionRule({
      id: "b-rule",
      effect: "allow",
      capability: "fs.modify",
      workspaceId: "b",
      scope: "persistent",
    });

    useKiroComputerStore.getState().removeWorkspace("a");

    expect(useKiroComputerStore.getState().permissionRules.map((r) => r.id)).toEqual([
      "b-rule",
    ]);
  });

  it("persisted state includes activeWorkspaceId", () => {
    const store = useKiroComputerStore.getState();
    store.addWorkspace(ws("research", "论文研究"));
    store.setActiveWorkspaceId("research");

    const persisted = useKiroComputerStore.persist.getOptions().partialize?.(
      useKiroComputerStore.getState()
    ) as { activeWorkspaceId?: string | null };

    expect(persisted.activeWorkspaceId).toBe("research");
  });

  it("migrate v1→v2：legacy 重复 sandbox-default 只保留第一项（不删文件），active 重定向", () => {
    const legacy = {
      computerEnabled: true,
      activeWorkspaceId: "dup-2",
      agentMode: "guided" as const,
      workspaces: [
        {
          id: "sandbox-1",
          name: "Kiro Sandbox",
          roots: [
            { id: "r1", label: "Sandbox（当前浏览器）", access: "read-write" as const, adapterRef: "sandbox-default" },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "dup-2",
          name: "Kiro Sandbox",
          roots: [
            { id: "r1", label: "Sandbox（当前浏览器）", access: "read-write" as const, adapterRef: "sandbox-default" },
          ],
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "browser-1",
          name: "论文资料",
          roots: [
            { id: "r1", label: "论文资料", access: "read-write" as const, adapterRef: "browser-grant-1" },
          ],
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      permissionRules: [
        { id: "r-dup", effect: "allow" as const, capability: "fs.modify" as const, workspaceId: "dup-2", scope: "persistent" as const },
        { id: "r-browser", effect: "allow" as const, capability: "fs.modify" as const, workspaceId: "browser-1", scope: "persistent" as const },
      ],
    };
    const migrated = useKiroComputerStore.persist.getOptions().migrate?.(legacy, 1) as {
      workspaces?: { id: string }[];
      activeWorkspaceId?: string | null;
      permissionRules?: { id: string }[];
    };
    expect(migrated.workspaces?.map((w) => w.id)).toEqual(["sandbox-1", "browser-1"]);
    expect(migrated.activeWorkspaceId).toBe("sandbox-1");
    expect(migrated.permissionRules?.map((r) => r.id)).toEqual(["r-browser"]);
    // 已是 v2 的 state 原样透传
    expect(useKiroComputerStore.persist.getOptions().migrate?.(legacy, 2)).toBe(legacy);
  });
});
