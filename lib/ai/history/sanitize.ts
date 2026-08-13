/**
 * Kiro Conversation History — sanitize / title / stale context 校验。
 * sanitizeConversation：把 Chat View 转成安全 Persistence Model（不含任何敏感数据）。
 */

import { KiroChatMessageView } from "@/hooks/useKiroChat";
import { actionToCardProps } from "@/components/kiro/KiroActionCard";
import {
  KiroConversationRecord,
  KiroConversationSummary,
  PersistedComputerTaskView,
  PersistedContextRef,
  PersistedKiroMessage,
} from "@/lib/ai/history/types";
import { KiroContextRef } from "@/lib/ai/context/types";
import type { AppState } from "@/store/useAppStore";
import { KiroAgentTask } from "@/lib/ai/computer/task";

/** 单条消息内容上限（极宽但有限，防止异常历史卡死 UI） */
export const MAX_PERSISTED_MESSAGE_CONTENT = 100_000;

function clampContent(text: string): string {
  if (text.length <= MAX_PERSISTED_MESSAGE_CONTENT) return text;
  return text.slice(0, MAX_PERSISTED_MESSAGE_CONTENT);
}

/** Computer Task（live 或 restored）→ 持久化展示视图（只存最小事实；不存 review/checkpoint/beforeText） */
export function toPersistedComputerTask(
  task: KiroAgentTask | undefined,
  restored: PersistedComputerTaskView | undefined
): PersistedComputerTaskView | undefined {
  const source = task ?? restored;
  if (!source) return undefined;
  const status = source.status === "completed" || source.status === "failed" || source.status === "cancelled" || source.status === "undone" || source.status === "undo_failed"
    ? source.status
    : "completed";
  return {
    taskId: "taskId" in source ? source.taskId : source.id,
    title: source.title,
    status,
    changes: source.changes.map((c) => ({
      operation: c.operation,
      resourceType: c.resourceType,
      displayName: c.displayName,
      workspaceLabel: c.workspaceLabel,
      rootLabel: c.rootLabel,
      relativePath: c.relativePath,
      artifactId: c.artifactId,
      fromRootId: c.fromRootId,
      fromRootLabel: c.fromRootLabel,
      fromRelativePath: c.fromRelativePath,
      format: c.format,
      size: c.size,
      changeCount: c.changeCount,
      revision: c.revision,
      verification: c.verification,
    })),
    startedAt: source.startedAt,
    completedAt: source.completedAt,
  };
}

/** 附件 → 持久化视图（local 临时文件标记未保留；material 保留安全引用） */
function toPersistedAttachments(
  attachments: KiroChatMessageView["attachments"]
): PersistedKiroMessage["attachments"] {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((a) =>
    a.source === "local"
      ? {
          id: a.id,
          source: "local" as const,
          kind: a.kind,
          name: a.name,
          size: a.size,
          tempNotRetained: true,
        }
      : {
          id: a.id,
          source: "material" as const,
          kind: a.kind,
          name: a.name,
          courseId: a.courseId,
          materialId: a.materialId,
          courseName: a.courseName,
        }
  );
}

/** 生成会话标题（本地 deterministic，不调模型）：第一条 User Message 取前 ~30 字 */
export function buildAutoTitle(firstUserText: string): string {
  const MAX = 30;
  const cleaned = firstUserText.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX) return cleaned;
  return `${cleaned.slice(0, MAX)}……`;
}

/**
 * sanitize：Chat View → Persistence Model。
 * 不保存：API Key / File / Blob / storageKey / tool arguments / 内部输出 / provider raw response。
 */
export function sanitizeConversation(input: {
  id: string;
  title: string;
  createdAt: string;
  provider: string;
  model: string;
  messages: KiroChatMessageView[];
  manualRefs: KiroContextRef[];
  entryRefs: KiroContextRef[];
  summary?: KiroConversationSummary | null;
}): KiroConversationRecord {
  const messages: PersistedKiroMessage[] = input.messages
    // Worklog V2：assistant 可能 Final Answer 为空但产生 Action Card —— 消息必须保留；
    // Part 3：Computer Task（仅展示事实）同理必须保留；
    // 旁白（assistantTurn.worklog）不进入历史
    .filter(
      (m) =>
        m.role === "user" ||
        m.content.length > 0 ||
        (m.actions?.length ?? 0) > 0 ||
        (m.historyActions?.length ?? 0) > 0 ||
        Boolean(m.computerTask || m.historyComputerTask)
    )
    .map((m) => {
      // live action（可 undo）→ 最小事实数据；恢复的历史 action 原样透传（canUndo 恒 false）
      const liveActions = (m.actions ?? []).map((a) => {
        const p = actionToCardProps(a.action);
        return {
          toolCallId: a.toolCallId,
          variant: p.variant,
          heading: p.heading,
          title: p.title,
          change: p.change ?? null,
          bullets: p.bullets,
          footer: p.footer,
          details: p.details,
        };
      });
      const actions =
        liveActions.length > 0 || (m.historyActions ?? []).length > 0
          ? [...liveActions, ...(m.historyActions ?? [])]
          : undefined;
      return {
        id: m.id,
        role: m.role,
        content: clampContent(m.content),
        attachments: toPersistedAttachments(m.attachments),
        actions,
        // Citation 来源最小元数据（不含正文；旧消息无 sources 则不写）
        sources: m.sources && m.sources.length > 0 ? m.sources : undefined,
        // Computer Task 展示事实（Part 3；无 review/checkpoint/beforeText）
        computerTask: toPersistedComputerTask(m.computerTask, m.historyComputerTask),
      };
    });

  const toRefs = (refs: KiroContextRef[]): PersistedContextRef[] =>
    refs.map((r) => ({ kind: r.kind, entityId: r.entityId, label: r.label }));

  return {
    id: input.id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    messages,
    manualRefs: toRefs(input.manualRefs),
    entryRefs: toRefs(input.entryRefs),
    summary: input.summary ?? undefined,
  };
}

/** 恢复 Context Ref 前校验实体是否仍存在；week 恒有效（时间范围语义） */
export function filterValidContextRefs(
  refs: PersistedContextRef[],
  state: Pick<AppState, "courses" | "assignments" | "groupProjects">
): PersistedContextRef[] {
  return refs.filter((r) => {
    if (r.kind === "week") return true;
    if (r.kind === "course") return state.courses.some((c) => c.id === r.entityId);
    if (r.kind === "assignment") return state.assignments.some((a) => a.id === r.entityId);
    if (r.kind === "group-project") return state.groupProjects.some((p) => p.id === r.entityId);
    if (r.kind === "material")
      return state.courses.some((c) => c.materials.some((m) => m.id === r.entityId));
    return false;
  });
}

/** 时间显示：今天 HH:mm / 昨天 / M月d日 */
export function formatHistoryTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= dayStart) return `今天 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (t >= dayStart - 86400000) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
