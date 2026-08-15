/**
 * Kiro Project IndexedDB 服务（V1）。
 * 成员关系单一事实源：conversations.projectId（绝不维护 ProjectRecord.conversationIds）。
 * 删除项目 + 清空关联 conversation.projectId 在同一个 transaction 内完成，
 * 避免中途失败产生 orphan projectId。
 */
import {
  openKiroDB,
  KIRO_PROJECTS_STORE,
  KIRO_CONVERSATIONS_STORE,
} from "@/lib/ai/storage/kiroDb";
import { KiroProjectRecord, createProjectId } from "@/lib/ai/projects/types";
import { KiroConversationRecord } from "@/lib/ai/history/types";

export async function listKiroProjects(): Promise<KiroProjectRecord[]> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readonly");
    const req = t.objectStore(KIRO_PROJECTS_STORE).getAll();
    req.onsuccess = () => {
      const projects = (req.result as KiroProjectRecord[]).filter(
        (p) => p && typeof p.id === "string" && typeof p.name === "string"
      );
      projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      resolve(projects);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getKiroProject(id: string): Promise<KiroProjectRecord | null> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readonly");
    const req = t.objectStore(KIRO_PROJECTS_STORE).get(id);
    req.onsuccess = () => resolve((req.result as KiroProjectRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function createKiroProject(input: { name: string; description?: string }): Promise<KiroProjectRecord> {
  const now = new Date().toISOString();
  const record: KiroProjectRecord = {
    id: createProjectId(),
    name: input.name,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readwrite");
    const req = t.objectStore(KIRO_PROJECTS_STORE).put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function updateKiroProject(id: string, patch: { name?: string; description?: string }): Promise<KiroProjectRecord> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readwrite");
    const store = t.objectStore(KIRO_PROJECTS_STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const existing = get.result as KiroProjectRecord | undefined;
      if (!existing) {
        reject(new Error("PROJECT_NOT_FOUND"));
        return;
      }
      const updated: KiroProjectRecord = {
        ...existing,
        name: patch.name ?? existing.name,
        description: patch.description !== undefined ? patch.description : existing.description,
        updatedAt: new Date().toISOString(),
      };
      const put = store.put(updated);
      put.onsuccess = () => resolve(updated);
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

/**
 * 删除项目 + 清空关联 conversations.projectId（同一 transaction）。
 * Conversation 本身完整保留（回到未归类）。
 */
export async function deleteKiroProjectAndUnassignConversations(id: string): Promise<void> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([KIRO_PROJECTS_STORE, KIRO_CONVERSATIONS_STORE], "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).delete(id);
    const convStore = t.objectStore(KIRO_CONVERSATIONS_STORE);
    const cursorReq = convStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const value = cursor.value as KiroConversationRecord | undefined;
      if (value && value.projectId === id) {
        // 删除属性（而非设为 undefined：undefined 仍会保留 key，导致 "projectId" in record === true）
        const cleaned = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "projectId"));
        cursor.update(cleaned);
      }
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** 成员关系单一事实源：conversation.projectId（null = 移出项目）。
 *  V1.1 integrity：projectId 非空时必须验证 Project 存在（同一 transaction，
 *  防止 conversation.projectId 指向不存在的 Project）。 */
export async function assignConversationToProject(conversationId: string, projectId: string | null): Promise<void> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([KIRO_PROJECTS_STORE, KIRO_CONVERSATIONS_STORE], "readwrite");
    const projStore = t.objectStore(KIRO_PROJECTS_STORE);
    const convStore = t.objectStore(KIRO_CONVERSATIONS_STORE);

    const update = () => {
      const get = convStore.get(conversationId);
      get.onsuccess = () => {
        const existing = get.result as KiroConversationRecord | undefined;
        if (!existing) {
          reject(new Error("CONVERSATION_NOT_FOUND"));
          return;
        }
        const updated: KiroConversationRecord = projectId
          ? { ...existing, projectId }
          : (Object.fromEntries(Object.entries(existing).filter(([k]) => k !== "projectId")) as KiroConversationRecord);
        const put = convStore.put(updated);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    };

    if (projectId !== null) {
      // 校验 Project 存在：不存在则整个 transaction 失败（不写一半）
      const projGet = projStore.get(projectId);
      projGet.onsuccess = () => {
        if (!projGet.result) {
          t.abort();
          reject(new Error("PROJECT_NOT_FOUND"));
          return;
        }
        update();
      };
      projGet.onerror = () => reject(projGet.error);
    } else {
      update();
    }
  });
}

/** 项目内 Conversation（updatedAt DESC；projectId 缺失记录不会出现） */
export async function listProjectConversations(projectId: string): Promise<KiroConversationRecord[]> {
  const db = await openKiroDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(KIRO_CONVERSATIONS_STORE, "readonly");
    const req = t.objectStore(KIRO_CONVERSATIONS_STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as KiroConversationRecord[]).filter(
        (c) => c && typeof c.id === "string" && c.projectId === projectId
      );
      all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}
