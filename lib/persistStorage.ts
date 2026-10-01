/**
 * 受守卫的 zustand persist storage：
 * localStorage 写满（QuotaExceeded）时 setItem 会抛错 —— 不捕获会沿调用栈炸掉当次
 * 业务 set（内存继续跑、重载回退旧快照，全程无提示）。此处吞掉配额错误并回调一次，
 * 调用方给清理空间指引；其它错误原样抛出（不掩盖真实 bug）。
 *
 * 类型与 createJSONStorage 对齐（PersistStorage<S>），替换时无感。
 */
import { createJSONStorage, type PersistStorage } from "zustand/middleware";

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
