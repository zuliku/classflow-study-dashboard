/**
 * Kiro Computer Agent V1 — Audit（Part 3）。
 * DB: classflow-kiro-computer-audit-v1 / store: entries，最多 500 条，超出删除 oldest。
 * 只存 metadata：timestamp/task/conversation/toolCall/tool/capability/decision/outcome/
 * workspace/root/relativePath/verification。
 * 禁止：file content / beforeText / tool input / handle / adapterRef / native path / bytes / token。
 */
import { ComputerCapability } from "@/lib/ai/computer/types";
import { ComputerApprovalDecision } from "@/lib/ai/computer/approval";

const AUDIT_DB = "classflow-kiro-computer-audit-v1";
const AUDIT_STORE = "entries";
const AUDIT_VERSION = 1;
export const COMPUTER_AUDIT_MAX_ENTRIES = 500;

export interface ComputerAuditEntry {
  id: string;
  timestamp: string;
  taskId: string;
  conversationId?: string | null;
  toolCallId: string;
  toolName: string;
  capability: ComputerCapability;
  /** 触发方式：auto（无需审批）/ allow-once / allow-session / allow-workspace / deny / timeout / none */
  decision: ComputerApprovalDecision | "auto" | "timeout" | "none";
  outcome: "executed" | "denied" | "undone" | "undo_failed" | "failed" | "error";
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  verification?: "passed" | "failed";
  /** Desktop Terminal V1（可选）：shell / risk / 命令预览（≤500）/ 结果事实。绝不记录 grantId / absolute path / 完整输出 */
  shell?: "powershell" | "cmd";
  risk?: "normal" | "destructive" | "privileged" | "blocked";
  commandPreview?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  /** Computer Use Phase 1（可选）：只读桌面观察事实。绝不记录 HWND/PID/像素/原始标题栈 */
  desktopTarget?: "active-window" | "screen";
  observationId?: string;
  uiElementCount?: number;
  /** Computer Use Phase 2（可选）：GUI 动作事实（动作 / 风险 / 执行方式 / 验证结果）。
   *  绝不记录输入文本 / 密码 / 坐标细节 / native 标识 */
  guiAction?:
    | "click"
    | "double_click"
    | "focus"
    | "type"
    | "key"
    | "scroll"
    | "wait";
  guiRisk?: "normal" | "external" | "destructive" | "sensitive" | "blocked";
  guiMethod?: string;
  changedWindow?: boolean;
  uiChanged?: boolean;
  /** Computer Use Phase 3（可选）：Desktop Session / 多窗口 / 应用事实。
   *  绝不记录密码 / Token / API key / native handle / 绝对敏感路径 */
  sessionId?: string;
  logicalApp?: string | null;
  windowLabel?: string | null;
  elementRole?: string;
  elementName?: string;
  /** V2.1（可选）：expect 确定性验证是否通过 */
  verificationPassed?: boolean;
  /** V2.3（可选）：计划步骤索引 / 计划短哈希（不含步骤原文） */
  stepIndex?: number;
  planHash?: string;
}

function openAuditDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(AUDIT_DB, AUDIT_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(AUDIT_STORE)) {
        req.result.createObjectStore(AUDIT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** 追加一条审计记录；总数超过 500 时删除 oldest（新记录计入总数） */
export async function appendComputerAuditEntry(entry: ComputerAuditEntry): Promise<void> {
  const db = await openAuditDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(AUDIT_STORE, "readwrite");
      const store = tx.objectStore(AUDIT_STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as string[]).sort();
        const overflow = keys.length + 1 - COMPUTER_AUDIT_MAX_ENTRIES;
        if (overflow > 0) {
          for (const k of keys.slice(0, overflow)) store.delete(k);
        }
        store.put(entry, entry.id);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** 最近 N 条（newest first；只读） */
export async function getRecentComputerAuditEntries(limit: number): Promise<ComputerAuditEntry[]> {
  const db = await openAuditDb();
  if (!db) return [];
  try {
    return await new Promise<ComputerAuditEntry[]>((resolve) => {
      const tx = db.transaction(AUDIT_STORE, "readonly");
      const store = tx.objectStore(AUDIT_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as ComputerAuditEntry[]).sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        );
        resolve(all.slice(0, Math.max(0, Math.min(limit, COMPUTER_AUDIT_MAX_ENTRIES))));
      };
      req.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

/** 只清 Audit metadata（不影响 Workspace / Permission / File / Conversation） */
export async function clearComputerAuditEntries(): Promise<void> {
  const db = await openAuditDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(AUDIT_STORE, "readwrite");
      tx.objectStore(AUDIT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
