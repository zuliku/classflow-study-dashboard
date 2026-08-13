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
});
