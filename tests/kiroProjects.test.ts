/**
 * Kiro Projects V1：IndexedDB 服务 + v3 migration 测试。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetKiroDbForTests,
  closeKiroDbForTests,
  openKiroDB,
  KIRO_DB_NAME,
  KIRO_PROJECTS_STORE,
  KIRO_CONVERSATIONS_STORE,
  KIRO_MEMORIES_STORE,
} from "@/lib/ai/storage/kiroDb";
import {
  listKiroProjects,
  getKiroProject,
  createKiroProject,
  updateKiroProject,
  deleteKiroProjectAndUnassignConversations,
  assignConversationToProject,
  listProjectConversations,
} from "@/lib/ai/projects/db";
import {
  saveConversation,
  getConversation,
  clearConversationHistory,
} from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";

function makeConversation(id: string, over: Partial<KiroConversationRecord> = {}): KiroConversationRecord {
  return {
    id,
    title: `对话 ${id}`,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    provider: "opencode-go",
    model: "kimi-k3",
    messages: [{ id: "u1", role: "user", content: "你好" }],
    manualRefs: [],
    entryRefs: [],
    ...over,
  };
}

beforeEach(async () => {
  await closeKiroDbForTests();
  resetKiroDbForTests();
  await clearConversationHistory().catch(() => {});
  // 清空 projects（保留 DB 缓存连接；逐条删除即可）
  const db = await openKiroDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
});

describe("Kiro Project CRUD", () => {
  it("1. create project → get / list", async () => {
    const p = await createKiroProject({ name: "项目 A" });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("项目 A");
    expect(await getKiroProject(p.id)).toMatchObject({ name: "项目 A" });
    const list = await listKiroProjects();
    expect(list.some((x) => x.id === p.id)).toBe(true);
  });

  it("2. update project：name / description / updatedAt 递增", async () => {
    const p = await createKiroProject({ name: "A" });
    const before = p.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateKiroProject(p.id, { name: "B", description: "描述" });
    expect(updated.name).toBe("B");
    expect(updated.description).toBe("描述");
    expect(updated.updatedAt >= before).toBe(true);
    expect((await getKiroProject(p.id))?.name).toBe("B");
  });

  it("3. list order：updatedAt DESC（更新过的排前面）", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    await new Promise((r) => setTimeout(r, 5));
    await updateKiroProject(a.id, { description: "d" });
    const list = await listKiroProjects();
    expect(list[0].id).toBe(a.id);
    expect(list.map((x) => x.id)).toContain(b.id);
  });
});

describe("Conversation membership（单一事实源 = conversation.projectId）", () => {
  it("4. assign conversation → 出现在 listProjectConversations", async () => {
    const p = await createKiroProject({ name: "P" });
    await saveConversation(makeConversation("c1"));
    await assignConversationToProject("c1", p.id);
    const inProject = await listProjectConversations(p.id);
    expect(inProject.map((c) => c.id)).toEqual(["c1"]);
    expect((await getConversation("c1"))?.projectId).toBe(p.id);
  });

  it("5. unassign（null）→ 移出项目，conversation 完整保留", async () => {
    const p = await createKiroProject({ name: "P" });
    await saveConversation(makeConversation("c1"));
    await assignConversationToProject("c1", p.id);
    await assignConversationToProject("c1", null);
    expect(await listProjectConversations(p.id)).toEqual([]);
    const rec = await getConversation("c1");
    expect(rec).toBeDefined();
    expect(rec?.title).toBe("对话 c1");
    expect("projectId" in (rec ?? {})).toBe(false);
  });

  it("6. move A → B：只有 B 包含；A 不残留（single membership）", async () => {
    const pa = await createKiroProject({ name: "A" });
    const pb = await createKiroProject({ name: "B" });
    await saveConversation(makeConversation("c1"));
    await assignConversationToProject("c1", pa.id);
    await assignConversationToProject("c1", pb.id);
    expect((await listProjectConversations(pa.id)).map((c) => c.id)).toEqual([]);
    expect((await listProjectConversations(pb.id)).map((c) => c.id)).toEqual(["c1"]);
    expect((await getConversation("c1"))?.projectId).toBe(pb.id);
  });

  it("7. 未知 conversation → assign 失败（不静默创建）", async () => {
    const p = await createKiroProject({ name: "P" });
    await expect(assignConversationToProject("nope", p.id)).rejects.toBeTruthy();
  });

  it("7b. V1.1：不存在 Project → assign reject PROJECT_NOT_FOUND，Conversation 不写一半", async () => {
    await saveConversation(makeConversation("c1"));
    await expect(assignConversationToProject("c1", "missing-project")).rejects.toThrow("PROJECT_NOT_FOUND");
    // transaction 未写一半：record 保持原状（无 projectId）
    const rec = await getConversation("c1");
    expect(rec).toBeDefined();
    expect("projectId" in (rec ?? {})).toBe(false);
  });

  it("7c. V1.1：移出（null）不需要 Project 存在", async () => {
    const p = await createKiroProject({ name: "P" });
    await saveConversation(makeConversation("c1"));
    await assignConversationToProject("c1", p.id);
    await assignConversationToProject("c1", null);
    expect("projectId" in ((await getConversation("c1")) ?? {})).toBe(false);
  });
});

describe("删除项目", () => {
  it("8+9+10. 删除项目：Project 删除、Conversation 保留、projectId 清空", async () => {
    const p = await createKiroProject({ name: "P" });
    const p2 = await createKiroProject({ name: "P2" });
    await saveConversation(makeConversation("c1"));
    await saveConversation(makeConversation("c2"));
    await assignConversationToProject("c1", p.id);
    await assignConversationToProject("c2", p2.id);

    await deleteKiroProjectAndUnassignConversations(p.id);

    expect(await getKiroProject(p.id)).toBeNull();
    const c1 = await getConversation("c1");
    expect(c1).toBeDefined(); // Conversation 不被删除
    expect("projectId" in (c1 ?? {})).toBe(false); // projectId 清空
    const c2 = await getConversation("c2");
    expect(c2?.projectId).toBe(p2.id); // 其他项目不受影响
  });

  it("11. 旧 conversation 无 projectId：正常读取，不在任何项目", async () => {
    await saveConversation(makeConversation("old"));
    const rec = await getConversation("old");
    expect(rec?.id).toBe("old");
    const projects = await listKiroProjects();
    for (const p of projects) {
      expect((await listProjectConversations(p.id)).some((c) => c.id === "old")).toBe(false);
    }
  });
});

describe("IndexedDB v2 → v3 migration", () => {
  function openDbAtVersion(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(KIRO_DB_NAME, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        // 模拟 v2 结构：conversations + memories（不含 projects / projectId index）
        if (!db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)) {
          db.createObjectStore(KIRO_CONVERSATIONS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(KIRO_MEMORIES_STORE)) {
          db.createObjectStore(KIRO_MEMORIES_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it("v2 数据保留；v3 增量补 projects store + conversations.projectId index", async () => {
    // 模拟用户从 v2 升级：先删库（清掉 beforeEach 已建好的 v3），再以 v2 建库写旧数据
    await closeKiroDbForTests();
    resetKiroDbForTests();
    await indexedDB.deleteDatabase(KIRO_DB_NAME);
    resetKiroDbForTests();
    const v2 = await openDbAtVersion(2);
    await new Promise<void>((resolve, reject) => {
      const t = v2.transaction([KIRO_CONVERSATIONS_STORE, KIRO_MEMORIES_STORE], "readwrite");
      t.objectStore(KIRO_CONVERSATIONS_STORE).put(makeConversation("legacy-conv"));
      t.objectStore(KIRO_MEMORIES_STORE).put({ id: "mem-1", content: "旧记忆" });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    v2.close();

    // 2. 重新打开 → v3 增量升级
    await closeKiroDbForTests();
    resetKiroDbForTests();
    const db = await openKiroDB();
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains(KIRO_PROJECTS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(KIRO_MEMORIES_STORE)).toBe(true);
    // conversations.projectId index 存在（增量补建，非删库重建）
    const convStore = db.transaction(KIRO_CONVERSATIONS_STORE, "readonly").objectStore(KIRO_CONVERSATIONS_STORE);
    expect(convStore.indexNames.contains("projectId")).toBe(true);
    const projStore = db.transaction(KIRO_PROJECTS_STORE, "readonly").objectStore(KIRO_PROJECTS_STORE);
    expect(projStore.indexNames.contains("updatedAt")).toBe(true);

    // 3. 旧 conversations / memories 完整保留
    expect((await getConversation("legacy-conv"))?.title).toBe("对话 legacy-conv");
    const memory = await new Promise<unknown>((resolve, reject) => {
      const t = db.transaction(KIRO_MEMORIES_STORE, "readonly");
      const req = t.objectStore(KIRO_MEMORIES_STORE).get("mem-1");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect((memory as { content?: string })?.content).toBe("旧记忆");

    // 4. 新 projects store 可用
    const p = await createKiroProject({ name: "迁移后项目" });
    expect((await getKiroProject(p.id))?.name).toBe("迁移后项目");
  });

  it("全新 DB 直接开 v3：三个 store 全部就位", async () => {
    await closeKiroDbForTests();
    resetKiroDbForTests();
    await indexedDB.deleteDatabase(KIRO_DB_NAME);
    resetKiroDbForTests();
    const db = await openKiroDB();
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains(KIRO_PROJECTS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(KIRO_MEMORIES_STORE)).toBe(true);
  });
});
