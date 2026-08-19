/**
 * Interactive Terminal Handle Registry（Phase 3 async lifecycle）。
 *
 * 解决 run_terminal_command 的同步语义导致 start 后 handle 失效的问题：
 * - start_terminal_command 在 spawn 成功后立即返回 opaque handle（process 仍 alive）
 * - write_terminal_input 通过 handle 找到 executionId 并写入 stdin
 * - wait_terminal_command 等待同一 handle 的最终 sanitized 结果
 *
 * 每条记录：
 * - handle (opaque, th-xxxx) ↔ executionId
 * - status, startedAt, resultPromise, finalResult
 * - TTL：process 终态后保留短时间供 wait 读取，随后自动清理
 */

import { ClassFlowDesktopTerminalShell } from "@/lib/desktop/types";

export interface InteractiveHandleRecord {
  handle: string;
  executionId: string;
  toolCallId: string;
  shell: ClassFlowDesktopTerminalShell;
  commandPreview: string;
  status: "running" | "completed" | "failed" | "cancelled" | "timed-out";
  startedAt: number;
  resultPromise: Promise<InteractiveFinalResult>;
  finalResult?: InteractiveFinalResult;
  resolve?: (r: InteractiveFinalResult) => void;
  reject?: (e: Error) => void;
  ttlTimer?: ReturnType<typeof setTimeout>;
}

export interface InteractiveFinalResult {
  status: "completed" | "failed" | "cancelled" | "timed-out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

const HANDLE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HANDLES = 32;

const interactiveHandles = new Map<string, InteractiveHandleRecord>();
const executionIdToHandle = new Map<string, string>();

export function createInteractiveHandle(
  executionId: string,
  toolCallId: string,
  shell: ClassFlowDesktopTerminalShell,
  commandPreview: string,
): string {
  const handle = `th-${crypto.randomUUID().slice(0, 8)}`;
  // 上限保护：超过时丢弃最旧的已终态 handle
  if (interactiveHandles.size >= MAX_HANDLES) {
    const oldest = Array.from(interactiveHandles.entries()).find(([, r]) => r.finalResult);
    if (oldest) {
      deleteInteractiveHandle(oldest[0]);
    } else {
      const firstKey = interactiveHandles.keys().next().value as string | undefined;
      if (firstKey) deleteInteractiveHandle(firstKey);
    }
  }
  let resolve!: (r: InteractiveFinalResult) => void;
  let reject!: (e: Error) => void;
  const resultPromise = new Promise<InteractiveFinalResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const record: InteractiveHandleRecord = {
    handle,
    executionId,
    toolCallId,
    shell,
    commandPreview,
    status: "running",
    startedAt: Date.now(),
    resultPromise,
    resolve,
    reject,
  };
  interactiveHandles.set(handle, record);
  executionIdToHandle.set(executionId, handle);
  return handle;
}

export function getInteractiveRecord(handle: string): InteractiveHandleRecord | undefined {
  return interactiveHandles.get(handle);
}

export function getInteractiveRecordByExecutionId(executionId: string): InteractiveHandleRecord | undefined {
  const handle = executionIdToHandle.get(executionId);
  if (!handle) return undefined;
  return interactiveHandles.get(handle);
}

export function setInteractivePromise(handle: string, promise: Promise<InteractiveFinalResult>): void {
  const record = interactiveHandles.get(handle);
  if (!record) return;
  // 链式：当外部 promise settle 时，同步更新 record
  promise.then(
    (result) => {
      resolveInteractiveHandle(handle, result);
    },
    (err: Error & { code?: string }) => {
      // 区分 cancel/timed-out 等？外部 promise 若 reject CANCELLED，视为 cancelled
      if (err?.code === "CANCELLED") {
        resolveInteractiveHandle(handle, {
          status: "cancelled",
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - record.startedAt,
          truncated: false,
          timedOut: false,
        });
      } else {
        record.reject?.(err);
        record.status = "failed";
        scheduleTTL(handle);
      }
    }
  );
  // 同时覆盖 resultPromise 以支持 wait 直接 await 外部 promise
  record.resultPromise = promise.then(
    (r) => {
      // 确保 finalResult 已设置
      if (!record.finalResult) record.finalResult = r as InteractiveFinalResult;
      return r as InteractiveFinalResult;
    },
    (e) => {
      throw e;
    }
  ) as Promise<InteractiveFinalResult>;
}

export function resolveInteractiveHandle(handle: string, result: InteractiveFinalResult): void {
  const record = interactiveHandles.get(handle);
  if (!record) return;
  record.finalResult = result;
  record.status = result.status;
  record.resolve?.(result);
  scheduleTTL(handle);
}

export function rejectInteractiveHandle(handle: string, error: Error): void {
  const record = interactiveHandles.get(handle);
  if (!record) return;
  record.reject?.(error);
  record.status = "failed";
  scheduleTTL(handle);
}

function scheduleTTL(handle: string): void {
  const record = interactiveHandles.get(handle);
  if (!record) return;
  if (record.ttlTimer) clearTimeout(record.ttlTimer);
  record.ttlTimer = setTimeout(() => {
    deleteInteractiveHandle(handle);
  }, HANDLE_TTL_MS);
  // 不阻塞进程退出
  if (record.ttlTimer && typeof (record.ttlTimer as unknown as { unref?: () => void }).unref === "function") {
    (record.ttlTimer as unknown as { unref: () => void }).unref();
  }
}

export function deleteInteractiveHandle(handle: string): void {
  const record = interactiveHandles.get(handle);
  if (!record) return;
  if (record.ttlTimer) clearTimeout(record.ttlTimer);
  interactiveHandles.delete(handle);
  executionIdToHandle.delete(record.executionId);
}

export function activeInteractiveHandleCount(): number {
  return Array.from(interactiveHandles.values()).filter((r) => r.status === "running").length;
}

export function totalInteractiveHandleCount(): number {
  return interactiveHandles.size;
}

export function clearAllInteractiveHandles(): void {
  for (const handle of Array.from(interactiveHandles.keys())) {
    deleteInteractiveHandle(handle);
  }
}

/** 暴露给测试：直接检查 handle 是否存在（不暴露给模型） */
export function hasInteractiveHandle(handle: string): boolean {
  return interactiveHandles.has(handle);
}
