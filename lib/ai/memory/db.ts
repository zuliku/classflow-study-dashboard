/**
 * Memory IndexedDB 存储（复用 classflow-kiro v2 memories store）。
 * CRUD + deterministic 去重（不引入 Embedding / 语义索引）。
 */

import { openKiroDB, kiroTx, KIRO_MEMORIES_STORE } from "@/lib/ai/storage/kiroDb";
import { KiroMemory, MemoryCategory, MemoryScope, MAX_MEMORIES, MAX_MEMORY_TITLE, MAX_MEMORY_CONTENT, MAX_MEMORY_TAGS } from "@/lib/ai/memory/types";

function createMemoryId(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** deterministic 归一化（去重键）：trim + 压缩空白 + 英文小写 */
export function normalizeMemoryText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 保存前 sanitize（长度限制）；明显 secret 返回 null */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{4,}\b/,
  /blob:[A-Za-z0-9:/._-]+/i,
  /storageKey["':\s=]+[A-Za-z0-9_-]+/i,
  /password["':\s=]+[A-Za-z0-9_-]{4,}/i,
  /token["':\s=]+[A-Za-z0-9_-]{8,}/i,
];

export function sanitizeMemoryContent(content: string): string | null {
  if (SECRET_PATTERNS.some((re) => re.test(content))) return null;
  return content.trim().slice(0, MAX_MEMORY_CONTENT);
}

export interface MemoryDraft {
  title?: string;
  content: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  scopeId?: string;
  tags?: string[];
}

/** 保存记忆；完全相同（category+scope+scopeId+normalized content）时去重返回已有 */
export async function saveMemory(draft: MemoryDraft): Promise<{ memory: KiroMemory; created: boolean; code?: string }> {
  const content = sanitizeMemoryContent(draft.content);
  if (content === null) return { memory: null as never, created: false, code: "MEMORY_SENSITIVE_CONTENT" };
  const title = (draft.title ?? content.slice(0, 24)).trim().slice(0, MAX_MEMORY_TITLE);
  const tags = (draft.tags ?? []).slice(0, MAX_MEMORY_TAGS).map((t) => t.trim()).filter(Boolean);

  const now = new Date().toISOString();
  const norm = normalizeMemoryText(content);
  const scope = draft.scope ?? "global";
  const scopeId = scope === "global" ? undefined : draft.scopeId;

  // 去重：同 category + scope + scopeId + normalized content
  const existing = await kiroTx<KiroMemory[]>(KIRO_MEMORIES_STORE, "readonly", (s) => s.getAll());
  const dup = (existing ?? []).find(
    (m) =>
      m.category === (draft.category ?? "other") &&
      m.scope === scope &&
      (m.scopeId ?? undefined) === scopeId &&
      normalizeMemoryText(m.content) === norm
  );
  if (dup) return { memory: dup, created: false };

  // 数量上限：超出时拒绝（不静默丢弃旧记忆）
  if ((existing ?? []).length >= MAX_MEMORIES) {
    return { memory: null as never, created: false, code: "MEMORY_LIMIT_REACHED" };
  }

  const memory: KiroMemory = {
    id: createMemoryId(),
    title: title || "未命名偏好",
    content,
    category: draft.category ?? "other",
    scope,
    scopeId,
    tags,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await kiroTx(KIRO_MEMORIES_STORE, "readwrite", (s) => s.put(memory));
  return { memory, created: true };
}

export async function listMemories(): Promise<KiroMemory[]> {
  const all = await kiroTx<KiroMemory[]>(KIRO_MEMORIES_STORE, "readonly", (s) => s.getAll());
  return (all ?? [])
    .filter((m) => m && typeof m.id === "string" && typeof m.content === "string")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getMemory(id: string): Promise<KiroMemory | null> {
  const m = await kiroTx<KiroMemory | undefined>(KIRO_MEMORIES_STORE, "readonly", (s) => s.get(id));
  return m ?? null;
}

export async function updateMemory(
  id: string,
  patch: { title?: string; content?: string; category?: MemoryCategory; scope?: MemoryScope; scopeId?: string; tags?: string[]; active?: boolean }
): Promise<{ ok: boolean; code?: string }> {
  const before = await getMemory(id);
  if (!before) return { ok: false, code: "NOT_FOUND" };
  let content = before.content;
  if (patch.content !== undefined) {
    const cleaned = sanitizeMemoryContent(patch.content);
    if (cleaned === null) return { ok: false, code: "MEMORY_SENSITIVE_CONTENT" };
    content = cleaned;
  }
  const memory: KiroMemory = {
    ...before,
    title: patch.title !== undefined ? patch.title.trim().slice(0, MAX_MEMORY_TITLE) : before.title,
    content,
    category: patch.category ?? before.category,
    scope: patch.scope ?? before.scope,
    scopeId: patch.scope !== undefined ? (patch.scope === "global" ? undefined : patch.scopeId) : before.scopeId,
    tags: patch.tags !== undefined ? patch.tags.slice(0, MAX_MEMORY_TAGS) : before.tags,
    active: patch.active ?? before.active,
    updatedAt: new Date().toISOString(),
  };
  await kiroTx(KIRO_MEMORIES_STORE, "readwrite", (s) => s.put(memory));
  return { ok: true };
}

export async function deleteMemory(id: string): Promise<void> {
  await kiroTx(KIRO_MEMORIES_STORE, "readwrite", (s) => s.delete(id));
}

export async function clearMemories(): Promise<void> {
  await openKiroDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(KIRO_MEMORIES_STORE, "readwrite");
        t.objectStore(KIRO_MEMORIES_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      })
  );
}
