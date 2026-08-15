/**
 * Kiro Project Files（V1.3A）：DB CRUD / v3→v4 migration / orphan reconcile / read_project_file / prompt index。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetKiroDbForTests,
  closeKiroDbForTests,
  openKiroDB,
  KIRO_DB_NAME,
  KIRO_PROJECT_FILES_STORE,
  KIRO_PROJECTS_STORE,
  KIRO_CONVERSATIONS_STORE,
  KIRO_MEMORIES_STORE,
} from "@/lib/ai/storage/kiroDb";
import {
  createKiroProject,
  getKiroProject,
  deleteKiroProjectAndUnassignConversations,
} from "@/lib/ai/projects/db";
import {
  listProjectFiles,
  getProjectFile,
  createProjectFile,
  deleteProjectFile,
  listAllProjectFileStorageKeys,
} from "@/lib/ai/projects/files/db";
import {
  KiroProjectFileRecord,
  MAX_PROJECT_FILES_PER_PROJECT,
} from "@/lib/ai/projects/files/types";
import { saveConversation, getConversation, clearConversationHistory } from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import {
  createStorageKey,
  saveFileBlob,
  getFileBlob,
  listFileKeys,
  reconcileOrphanBlobs,
  deleteFileBlob,
  clearAllFileBlobs,
} from "@/lib/fileStorage";
import { executeReadProjectFile } from "@/lib/ai/tools/read/projectFile";
import { normalizeProjectTurnContext, buildProjectContextSection } from "@/lib/ai/projects/prompt";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";

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

function makeFile(over: Partial<KiroProjectFileRecord> = {}): KiroProjectFileRecord {
  return {
    id: `pf_${Math.random().toString(36).slice(2, 10)}`,
    projectId: "proj-x",
    name: "notes.md",
    mimeType: "text/markdown",
    sizeBytes: 12,
    kind: "text",
    storageKey: createStorageKey(),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const textBlob = (text: string, name = "notes.md") =>
  new Blob([text], { type: "text/markdown" }) as Blob & { name?: string; lastModified?: number };

beforeEach(async () => {
  await closeKiroDbForTests();
  resetKiroDbForTests();
  await clearConversationHistory().catch(() => {});
  // classflow-files（Blob DB）同样清空，避免跨测试累计
  await clearAllFileBlobs().catch(() => {});
  const db = await openKiroDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([KIRO_PROJECTS_STORE, KIRO_PROJECT_FILES_STORE], "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).clear();
    t.objectStore(KIRO_PROJECT_FILES_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
});

describe("Project File DB", () => {
  it("1. create + list + get", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("abc") });
    expect(f.id.startsWith("pf_")).toBe(true);
    const list = await listProjectFiles(p.id);
    expect(list.map((x) => x.id)).toEqual([f.id]);
    expect((await getProjectFile(f.id))?.name).toBe("a.md");
    // Blob 真实保存
    expect((await getFileBlob(f.storageKey))?.size).toBe(3);
  });

  it("2. Project A/B 隔离", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    const fa = await createProjectFile({ projectId: a.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("aaa") });
    await createProjectFile({ projectId: b.id, name: "b.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("bbb") });
    expect((await listProjectFiles(a.id)).map((x) => x.id)).toEqual([fa.id]);
  });

  it("3. 删除单个 file：metadata + Blob 删除", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("abc") });
    await deleteProjectFile(f.id);
    expect(await getProjectFile(f.id)).toBeNull();
    expect(await getFileBlob(f.storageKey)).toBeNull();
  });

  it("4. 无效 Project → PROJECT_NOT_FOUND（不写 metadata/blob）", async () => {
    const keysBefore = await listFileKeys();
    await expect(
      createProjectFile({ projectId: "missing", name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("abc") })
    ).rejects.toThrow("PROJECT_NOT_FOUND");
    expect(await listFileKeys()).toEqual(keysBefore);
  });

  it("5. 20 file cap → PROJECT_FILE_LIMIT_REACHED", async () => {
    const p = await createKiroProject({ name: "P" });
    for (let i = 0; i < MAX_PROJECT_FILES_PER_PROJECT; i++) {
      await createProjectFile({ projectId: p.id, name: `f${i}.md`, mimeType: "text/markdown", sizeBytes: 1, kind: "text", blob: textBlob("x") });
    }
    await expect(
      createProjectFile({ projectId: p.id, name: "over.md", mimeType: "text/markdown", sizeBytes: 1, kind: "text", blob: textBlob("x") })
    ).rejects.toThrow("PROJECT_FILE_LIMIT_REACHED");
  });

  it("6. 删除 Project → file metadata 消失 + Blob 清理；Conversation 保留且真正 unassign", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("abc") });
    // Conversation 必须真实带 projectId，否则无法证明 unassign 真的执行（V1.3A.1 防假阳性）
    await saveConversation(makeConversation("c1", { projectId: p.id }));
    await deleteKiroProjectAndUnassignConversations(p.id);
    expect(await listProjectFiles(p.id)).toEqual([]);
    expect(await getProjectFile(f.id)).toBeNull();
    expect(await getFileBlob(f.storageKey)).toBeNull();
    const c1 = await getConversation("c1");
    expect(c1).toBeDefined();
    expect("projectId" in (c1 ?? {})).toBe(false);
  });

  it("6b. V1.3A.1：删除 A 不得触碰 B 的 metadata / Blob / Conversation membership", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    const a1 = await createProjectFile({ projectId: a.id, name: "a1.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("AAA1") });
    const a2 = await createProjectFile({ projectId: a.id, name: "a2.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("AAA2") });
    const b1 = await createProjectFile({ projectId: b.id, name: "b1.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("BBB1") });
    const b2 = await createProjectFile({ projectId: b.id, name: "b2.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("BBB2") });
    await saveConversation(makeConversation("ca", { projectId: a.id }));
    await saveConversation(makeConversation("cb", { projectId: b.id }));

    await deleteKiroProjectAndUnassignConversations(a.id);

    // A：project 删除、文件 metadata/blob 全清
    expect(await getKiroProject(a.id)).toBeNull();
    expect(await getProjectFile(a1.id)).toBeNull();
    expect(await getProjectFile(a2.id)).toBeNull();
    expect(await getFileBlob(a1.storageKey)).toBeNull();
    expect(await getFileBlob(a2.storageKey)).toBeNull();
    // CA：保留且 unassigned
    const ca = await getConversation("ca");
    expect(ca).toBeDefined();
    expect("projectId" in (ca ?? {})).toBe(false);

    // B：完全不受影响 —— metadata 保留
    expect(await getProjectFile(b1.id)).not.toBeNull();
    expect(await getProjectFile(b2.id)).not.toBeNull();
    expect((await listProjectFiles(b.id)).map((x) => x.id).sort()).toEqual([b1.id, b2.id].sort());
    // B：Blob 保留（防止只修 metadata filter 却仍误删 Blob）
    expect(await getFileBlob(b1.storageKey)).not.toBeNull();
    expect(await getFileBlob(b2.storageKey)).not.toBeNull();
    expect((await getFileBlob(b1.storageKey))?.text()).resolves.toContain("BBB1");
    // CB：membership 保持
    expect((await getConversation("cb"))?.projectId).toBe(b.id);
  });
});

describe("IndexedDB v3 → v4 migration", () => {
  function openDbAtVersion(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(KIRO_DB_NAME, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        // 模拟 v3 结构：conversations + memories + projects（含 instructions）
        if (!db.objectStoreNames.contains(KIRO_CONVERSATIONS_STORE)) {
          db.createObjectStore(KIRO_CONVERSATIONS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(KIRO_MEMORIES_STORE)) {
          db.createObjectStore(KIRO_MEMORIES_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(KIRO_PROJECTS_STORE)) {
          db.createObjectStore(KIRO_PROJECTS_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it("v3 数据保留；v4 增量补 project-files store + index", async () => {
    await closeKiroDbForTests();
    resetKiroDbForTests();
    await indexedDB.deleteDatabase(KIRO_DB_NAME);
    resetKiroDbForTests();
    const v3 = await openDbAtVersion(3);
    await new Promise<void>((resolve, reject) => {
      const t = v3.transaction([KIRO_CONVERSATIONS_STORE, KIRO_MEMORIES_STORE, KIRO_PROJECTS_STORE], "readwrite");
      t.objectStore(KIRO_CONVERSATIONS_STORE).put(makeConversation("legacy-conv"));
      t.objectStore(KIRO_MEMORIES_STORE).put({ id: "mem-1", content: "旧记忆" });
      t.objectStore(KIRO_PROJECTS_STORE).put({ id: "proj-legacy", name: "旧项目", instructions: "旧指令", createdAt: "t", updatedAt: "t" });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    v3.close();

    await closeKiroDbForTests();
    resetKiroDbForTests();
    const db = await openKiroDB();
    expect(db.version).toBe(4);
    expect(db.objectStoreNames.contains(KIRO_PROJECT_FILES_STORE)).toBe(true);
    const filesStore = db.transaction(KIRO_PROJECT_FILES_STORE, "readonly").objectStore(KIRO_PROJECT_FILES_STORE);
    expect(filesStore.indexNames.contains("projectId")).toBe(true);
    // 旧三类数据保留（含 instructions）
    expect((await getConversation("legacy-conv"))?.id).toBe("legacy-conv");
    const memory = await new Promise<unknown>((resolve, reject) => {
      const t = db.transaction(KIRO_MEMORIES_STORE, "readonly");
      const req = t.objectStore(KIRO_MEMORIES_STORE).get("mem-1");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect((memory as { content?: string })?.content).toBe("旧记忆");
    const proj = await new Promise<unknown>((resolve, reject) => {
      const t = db.transaction(KIRO_PROJECTS_STORE, "readonly");
      const req = t.objectStore(KIRO_PROJECTS_STORE).get("proj-legacy");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect((proj as { instructions?: string })?.instructions).toBe("旧指令");
  });
});

describe("Orphan Blob reconcile（V1.3A correctness gate）", () => {
  it("Course + Project Blob 保留；真 orphan 被删除", async () => {
    // 造三类 key：course / project / orphan
    const courseKey = createStorageKey();
    const projectKey = createStorageKey();
    const orphanKey = createStorageKey();
    await saveFileBlob(courseKey, textBlob("course"));
    await saveFileBlob(projectKey, textBlob("project"));
    await saveFileBlob(orphanKey, textBlob("orphan"));

    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: textBlob("abc") });

    // validKeys = course（手工）+ project（来自 DB）
    const valid = new Set<string>([courseKey, ...(await listAllProjectFileStorageKeys())]);
    expect(valid.has(f.storageKey)).toBe(true);
    const r = await reconcileOrphanBlobs(valid);
    // projectKey（伪造，非真实 record）与 orphanKey 都是 orphan；f.storageKey 真实保留
    expect(r.deleted).toBe(2);
    expect(await getFileBlob(courseKey)).not.toBeNull();
    expect(await getFileBlob(projectKey)).toBeNull();
    expect(await getFileBlob(f.storageKey)).not.toBeNull();
    expect(await getFileBlob(orphanKey)).toBeNull();
  });
});

describe("read_project_file executor", () => {
  const frozenA: KiroProjectTurnContext = { id: "proj-a", name: "A", files: [{ id: "pf_a1", name: "a.md", kind: "text", sizeBytes: 3 }] };

  it("TXT：返回正文；register 数据含 projectFileId", async () => {
    const p = await createKiroProject({ name: "A" });
    const f = await createProjectFile({ projectId: p.id, name: "a.md", mimeType: "text/markdown", sizeBytes: 12, kind: "text", blob: textBlob("PROJECT_DOC_SENTINEL") });
    const r = await executeReadProjectFile(
      { projectFileId: f.id },
      { id: p.id, name: "A", files: [{ id: f.id, name: "a.md", kind: "text", sizeBytes: 12 }] }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.text).toContain("PROJECT_DOC_SENTINEL");
    expect(r.data.name).toBe("a.md");
    expect("storageKey" in r.data).toBe(false);
  });

  it("无 frozen context → NOT_FOUND", async () => {
    const r = await executeReadProjectFile({ projectFileId: "pf_x" }, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_FOUND");
  });

  it("跨 Project 读取被拒绝（frozen A，调用 B 的文件）", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    const fb = await createProjectFile({ projectId: b.id, name: "b.md", mimeType: "text/markdown", sizeBytes: 12, kind: "text", blob: textBlob("B_SECRET") });
    // B 文件真实存在
    expect(await getFileBlob(fb.storageKey)).not.toBeNull();
    // 但不在 A 的 frozen index
    const r = await executeReadProjectFile({ projectFileId: fb.id }, { ...frozenA, id: a.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_FOUND");
  });

  it("frozen index 中有但 metadata.projectId 不匹配 → 拒绝（双重检查）", async () => {
    const b = await createKiroProject({ name: "B" });
    const fb = await createProjectFile({ projectId: b.id, name: "b.md", mimeType: "text/markdown", sizeBytes: 12, kind: "text", blob: textBlob("B_SECRET") });
    // A 的 frozen index 伪造包含 pf_b1（模型猜 id）→ record.projectId 检查必须拒绝
    const ctx: KiroProjectTurnContext = { id: "proj-a", name: "A", files: [{ id: fb.id, name: "b.md", kind: "text", sizeBytes: 12 }] };
    const r = await executeReadProjectFile({ projectFileId: fb.id }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_FOUND");
  });

  it("未知 projectFileId（不在 frozen index）→ NOT_FOUND", async () => {
    const r = await executeReadProjectFile({ projectFileId: "pf_unknown" }, frozenA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_FOUND");
  });
});

describe("Prompt Project File Index", () => {
  it("normalize 只保留 safe files metadata（丢弃 storageKey/apiKey/text/description；image 合法）", () => {
    const ctx = normalizeProjectTurnContext({
      id: "proj-a",
      name: "P",
      instructions: "PROJECT_RULE",
      files: [
        { id: "pf_1", name: "A.pdf", kind: "pdf", sizeBytes: 100, storageKey: "file_secret", apiKey: "sk-x", text: "SECRET_TEXT", description: "d" },
        { id: "pf_2", name: "B.docx", kind: "docx", sizeBytes: 200 },
        { id: "pf_3", name: "bad", kind: "video", sizeBytes: 5 },
        { id: "pf_4", name: "pic.png", kind: "image", sizeBytes: 300 },
      ],
    });
    expect(ctx?.instructions).toBe("PROJECT_RULE");
    expect(ctx?.files).toEqual([
      { id: "pf_1", name: "A.pdf", kind: "pdf", sizeBytes: 100 },
      { id: "pf_2", name: "B.docx", kind: "docx", sizeBytes: 200 },
      { id: "pf_4", name: "pic.png", kind: "image", sizeBytes: 300 },
    ]);
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("file_secret");
    expect(json).not.toContain("sk-x");
    expect(json).not.toContain("SECRET_TEXT");
  });

  it("contract：typed KiroProjectTurnContext（files index）→ normalize 保留 files[0]，section 可见文件名", () => {
    const context: KiroProjectTurnContext = {
      id: "proj-a",
      name: "A",
      instructions: "RULE",
      files: [
        {
          id: "pf-a",
          name: "notes.md",
          kind: "text",
          sizeBytes: 123,
        },
      ],
    };
    const normalized = normalizeProjectTurnContext(context);
    expect(normalized?.files).toEqual([{ id: "pf-a", name: "notes.md", kind: "text", sizeBytes: 123 }]);
    expect(normalized?.instructions).toBe("RULE");
    const s = buildProjectContextSection(context);
    expect(s).toContain("notes.md");
  });

  it("files 超过 20 → slice；非法条目丢弃", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `pf_${i}`, name: `f${i}.md`, kind: "text" as const, sizeBytes: i }));
    const ctx = normalizeProjectTurnContext({ id: "a", name: "P", files: many });
    expect(ctx?.files).toHaveLength(20);
  });

  it("prompt section：index-only，含文件名不含正文 sentinel；IMAGE 提示 read_project_visual", () => {
    const s = buildProjectContextSection({
      id: "proj-a",
      name: "论文研究",
      instructions: "PROJECT_RULE",
      files: [
        { id: "pf_123", name: "比赛细则.pdf", kind: "pdf", sizeBytes: 100 },
        { id: "pf_456", name: "研究框架.docx", kind: "docx", sizeBytes: 200 },
        { id: "pf_789", name: "示意图.png", kind: "image", sizeBytes: 300 },
      ],
    });
    expect(s).toContain("PROJECT_RULE");
    expect(s).toContain("比赛细则.pdf");
    expect(s).toContain("研究框架.docx");
    expect(s).toContain("示意图.png");
    expect(s).toContain("IMAGE");
    expect(s).toContain("read_project_file");
    expect(s).toContain("read_project_visual");
    expect(s).toContain("possiblyScanned / visualRequired");
    expect(s).toContain("不代表正文已读取");
    expect(s).not.toContain("FILE_BODY_SENTINEL");
    expect(s).not.toContain("storageKey");
  });

  it("无 files → 不产生项目资料块", () => {
    const s = buildProjectContextSection({ id: "a", name: "P", instructions: "R" });
    expect(s).not.toContain("## 项目资料");
  });
});
