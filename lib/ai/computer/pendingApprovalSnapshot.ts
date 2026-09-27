/**
 * S-fix（P0-2）：审批内存落盘 —— 刷新不再卡死。
 *
 * 背景：pending executable（input / frozenSnapshot / callbacks / task refs）是
 * runtime-only，不可序列化；刷新后精确 resume 同一条 tool call 不可能。
 * 本模块做诚实可行的事 —— 快照 + 开机对账：
 * - 审批出现时落一个轻量可序列化快照（request 脱敏展示信息 + owning conversation）；
 * - 决策/超时/切换/停止/卸载时清理快照（与 setPendingApproval(null) 路径一一对应）；
 * - App 启动时对账：快照仍在说明上次死在等待中 → 给 owning 会话追加一条
 *   中断说明（assistant 纯文本，历史恢复天然兼容），清快照，不留僵尸 UI。
 *
 * 与 approvalDeadlineAt 的关系：deadline 管“可预期”（倒计时 UI），快照管
 * “可恢复叙述”（刷新后不消失、不卡死）。两者由同一超时 effect 驱动。
 */

import { getConversation, saveConversation } from "@/lib/ai/history/db";
import type { PersistedKiroMessage } from "@/lib/ai/history/types";

/** 审批超时（与 useKiroChat 计时同源；此处为唯一声明处，hook 引用本常量） */
export const APPROVAL_TIMEOUT_MS = 3 * 60 * 1000;

const STORAGE_KEY = "classflow-kiro-pending-approval-v1";

export interface PendingApprovalSnapshot {
  version: 1;
  /** approval request id（幂等键；中断说明消息 id 由此派生） */
  approvalId: string;
  conversationId: string;
  taskId: string;
  toolName: string;
  /** 脱敏展示标题（落盘时由 presentation 纯函数计算，不存敏感字段） */
  title: string;
  /** 审批出现时间（unix ms；对账时判断是否已过超时 → 文案区分“超时取消/中断停止”） */
  createdAt: number;
}

function isSnapshot(value: unknown): value is PendingApprovalSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.approvalId === "string" &&
    typeof v.conversationId === "string" &&
    typeof v.taskId === "string" &&
    typeof v.toolName === "string" &&
    typeof v.title === "string" &&
    typeof v.createdAt === "number"
  );
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function writePendingApprovalSnapshot(snapshot: PendingApprovalSnapshot): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 隐私模式等写入失败 → 本次刷新后无对账，不阻塞审批主链路
  }
}

export function readPendingApprovalSnapshot(): PendingApprovalSnapshot | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingApprovalSnapshot(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function interruptionNoteId(snapshot: PendingApprovalSnapshot): string {
  return `interrupted-${snapshot.approvalId}`;
}

function interruptionNote(snapshot: PendingApprovalSnapshot): string {
  const timedOut = Date.now() - snapshot.createdAt >= APPROVAL_TIMEOUT_MS;
  return timedOut
    ? `上一次等待确认的操作（${snapshot.title}）已因超时自动取消。如需继续，请重新描述需求。`
    : `页面刷新前有一个待确认的操作（${snapshot.title}）未能完成，执行已停止。如需继续，请重新描述需求。`;
}

/**
 * 开机对账（App 启动调用一次，fire-and-forget）：
 * - 无快照 → false（无事发生）
 * - 有快照 → 消费（无论如何清快照）+ owning 会话存在则追加中断说明 → true
 * - 幂等：同一 approvalId 只追加一次（StrictMode 双挂载/重复调用安全）
 */
export async function reconcileStaleApprovalSnapshot(): Promise<boolean> {
  const snapshot = readPendingApprovalSnapshot();
  if (!snapshot) return false;
  try {
    const record = await getConversation(snapshot.conversationId);
    if (record) {
      const noteId = interruptionNoteId(snapshot);
      const already = record.messages.some((m) => m.id === noteId);
      if (!already) {
        const note: PersistedKiroMessage = {
          id: noteId,
          role: "assistant",
          content: interruptionNote(snapshot),
        };
        record.messages = [...record.messages, note];
        record.updatedAt = new Date().toISOString();
        await saveConversation(record);
      }
    }
  } catch {
    // 对账失败不阻塞启动；快照仍要消费，避免下次重复打扰
  } finally {
    clearPendingApprovalSnapshot();
  }
  return true;
}
