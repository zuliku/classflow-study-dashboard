/**
 * 受守卫的 zustand persist storage：
 * localStorage 写满（QuotaExceeded）时 setItem 会抛错 —— 不捕获会沿调用栈炸掉当次
 * 业务 set（内存继续跑、重载回退旧快照，全程无提示）。此处吞掉配额错误并回调一次，
 * 调用方给清理空间指引；其它错误原样抛出（不掩盖真实 bug）。
 *
 * 类型与 createJSONStorage 对齐（PersistStorage<S>），替换时无感。
 */
import { createJSONStorage, type PersistStorage } from "zustand/middleware";

/**
 * 跨窗口收敛（同源多窗口 last-write-wins 会丢字段）：
 * 监听 storage 事件，他窗写入本 key 后 500ms 去抖 rehydrate，把远端字段合进来。
 * - 已收敛（事件值与本地一致）直接跳过，不存在乒乓；
 * - rehydrate 走各 store 自有 merge/migrate，与启动路径一致；
 * - 返回取消订阅函数（测试/热更新用；生产常驻）。
 */
export function subscribeCrossWindowSync(
  storeApi: { persist?: { rehydrate: () => void | Promise<void> } },
  storageKey: string
): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey || e.newValue == null) return;
    try {
      if (window.localStorage.getItem(storageKey) === e.newValue) return;
    } catch {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        const r = storeApi.persist?.rehydrate();
        if (r && typeof (r as Promise<void>).catch === "function") {
          void (r as Promise<void>).catch(() => {});
        }
      } catch {
        /* 收敛失败不影响主流程 */
      }
    }, 500);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    if (timer) clearTimeout(timer);
  };
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_FILE_NO_DEVICE_SPACE") return true;
  if ((err as { code?: unknown })?.code === 22) return true;
  return /quota|配额/i.test(String((err as Error)?.message ?? err ?? ""));
}

export function createGuardedStorage<S>(onQuotaExceeded?: () => void): PersistStorage<S> {
  const inner = createJSONStorage(() => localStorage) as PersistStorage<S>;
  let notified = false;
  return {
    getItem: (name) => inner.getItem(name),
    // 同步直写（zustand persist 契约要求；防抖会破坏“写入后立即可读”，persist.test 已锁定）。
    // 高频全量 JSON.stringify 的优化应在 store 层做 partialize 拆分/节流 set 调用，见 P1-1 备注。
    setItem: (name, newValue) => {
      try {
        inner.setItem(name, newValue);
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        if (!notified) {
          notified = true;
          try {
            onQuotaExceeded?.();
          } catch {
            /* 通知失败不影响主流程 */
          }
        }
      }
    },
    removeItem: (name) => inner.removeItem(name),
  };
}
