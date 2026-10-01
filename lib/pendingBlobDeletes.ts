/**
 * 待删 Blob 持久化队列（撤销窗口关闭/刷新/崩溃不丢删除意图）：
 * - 资料删除走“撤销窗口”：Blob 在 toast onDismiss 后才删；窗口期内刷新 → onDismiss 永不执行，
 *   只能靠启动对账（还可能因 fail-closed 跳过）兜底。
 * - 本队列：onDismiss 先入队 → 删 Blob → 出队；崩溃/刷新后下次启动直接执行显式删除
 *   （与引用无关，不需要对账的 fail-closed 守卫；key 随机不复用，不会误删新引用）。
 */
import { deleteFileBlob } from "@/lib/fileStorage";

const QUEUE_KEY = "classflow-pending-blob-deletes";
const MAX_QUEUE = 200;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function readQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && KEY_PATTERN.test(k)).slice(0, MAX_QUEUE);
  } catch {
    return [];
  }
}

function writeQueue(keys: string[]): void {
  try {
    if (keys.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(keys.slice(0, MAX_QUEUE)));
  } catch {
    /* 队列写失败不阻断主流程（启动对账仍是兜底） */
  }
}

export function enqueuePendingBlobDelete(storageKey: string): void {
  if (typeof storageKey !== "string" || !KEY_PATTERN.test(storageKey)) return;
  const queue = readQueue();
  if (!queue.includes(storageKey)) writeQueue([...queue, storageKey]);
}

export function dequeuePendingBlobDelete(storageKey: string): void {
  const queue = readQueue();
  if (!queue.includes(storageKey)) return;
  writeQueue(queue.filter((k) => k !== storageKey));
}

export function listPendingBlobDeletes(): string[] {
  return readQueue();
}

/** 启动排水：逐个显式删除（单键失败不影响其余；删完才出队，崩溃可续） */
export async function drainPendingBlobDeletes(): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const key of readQueue()) {
    try {
      await deleteFileBlob(key);
      dequeuePendingBlobDelete(key);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}
