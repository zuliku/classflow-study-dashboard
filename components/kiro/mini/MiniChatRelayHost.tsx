"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useKiroRuntime,
  useKiroSessionActions,
  useKiroSessionMeta,
} from "@/components/kiro/KiroSessionProvider";
import { getClassFlowDesktopMiniBridge } from "@/lib/desktop/bridge";
import {
  base64ToBytes,
  buildMiniSnapshot,
  sanitizeMiniSend,
  type MiniChatApprovalSummary,
  type MiniChatConversationSummary,
  type MiniChatSnapshot,
  type MiniRemoteSendRequest,
} from "@/lib/ai/miniChat/protocol";
import { deriveMiniTelemetry } from "@/lib/ai/miniChat/telemetry";
import { canApproveInMini } from "@/lib/ai/miniChat/approval";
import { listConversations } from "@/lib/ai/history/db";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";
import { getComputerApprovalPresentation } from "@/lib/ai/ui/computerApprovalPresentation";
import type { ComputerApprovalDecision } from "@/lib/ai/computer/approval";

/** 快照推送节流（streaming token 按 ~150ms 合并；settle 由 messages 变化立即触发下一拍） */
const PUBLISH_THROTTLE_MS = 150;
/** 远端附件就绪等待（addFiles 提取轮询；超时则按现有附件直接发送，由 send 管线裁决） */
const READY_POLL_MS = 250;
const READY_TIMEOUT_MS = 30_000;

/**
 * Mini 常驻窗中继宿主（主窗口侧，Provider 持久根部单挂载，无 UI）：
 * - 只读快照节流 publish（`mini:publish-state`；Main 缓存 + 转推 Mini）；
 * - 远端发送：sanitize → base64 重建 File → 同一 attachments.addFiles →
 *   等就绪（bounded）→ 同一 chat.send（Composer onSend 同一入口，全管线复用）；
 * - 远端停止：同一 chat.stop；
 * - 会话命令：new chat / switch / focus（走同一 Session transition）；
 * - 低风险审批：Mini 只允许 deny / allow-once，且必须通过当前请求的 risk/后台/权限二次校验。
 */
export function MiniChatRelayHost() {
  const { chat, attachments } = useKiroRuntime();
  const {
    currentConversationId,
    conversationTitle,
    conversationTransitioning,
    historyVersion,
    suggestionsKind,
    currentTurnSources,
  } = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const pendingApproval = useKiroComputerRuntimeStore((s) => s.pendingApproval);
  const pendingQueueLength = useKiroComputerRuntimeStore((s) => s.pendingQueueLength);
  const approvalDeadlineAt = useKiroComputerRuntimeStore((s) => s.approvalDeadlineAt);
  const [conversations, setConversations] = useState<MiniChatConversationSummary[]>([]);
  const liveRef = useRef({ chat, attachments, currentConversationId, conversationTransitioning, actions });
  liveRef.current = { chat, attachments, currentConversationId, conversationTransitioning, actions };

  // 最近会话（低频；Mini 只展示标题/时间，不直读 DB）
  useEffect(() => {
    let alive = true;
    void listConversations()
      .then((list) => {
        if (!alive) return;
        setConversations(
          list.slice(0, 8).map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
          }))
        );
      })
      .catch(() => {
        if (alive) setConversations([]);
      });
    return () => {
      alive = false;
    };
  }, [historyVersion]);

  const approval: MiniChatApprovalSummary | null = useMemo(() => {
    if (!pendingApproval) return null;
    if (
      pendingApproval.conversationId != null &&
      pendingApproval.conversationId !== currentConversationId
    ) {
      return null;
    }
    const presentation = getComputerApprovalPresentation(pendingApproval);
    return {
      pending: true,
      id: pendingApproval.id,
      title: presentation.title,
      primary: presentation.primary,
      warnings: presentation.warnings,
      highRisk: presentation.highRisk,
      canApproveInMini: canApproveInMini(pendingApproval),
      queueLength: pendingQueueLength,
      ...(approvalDeadlineAt != null ? { deadlineAt: approvalDeadlineAt } : {}),
    };
  }, [pendingApproval, pendingQueueLength, approvalDeadlineAt, currentConversationId]);

  const busy = chat.turnInFlight || chat.streaming;
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
  const answerStarted = !!lastAssistant?.content?.trim();
  const telemetry = useMemo(
    () =>
      deriveMiniTelemetry({
        busy,
        streaming: chat.streaming,
        answerStarted,
        waitingApproval: !!approval,
        error: !!chat.error,
        activity: chat.activity,
        plans: chat.executionPlans,
        sources: currentTurnSources,
        suggestionsKind,
      }),
    [
      busy,
      chat.streaming,
      answerStarted,
      approval,
      chat.error,
      chat.activity,
      chat.executionPlans,
      currentTurnSources,
      suggestionsKind,
    ]
  );

  const snapshot: MiniChatSnapshot = useMemo(
    () =>
      buildMiniSnapshot({
        conversationId: currentConversationId,
        title:
          conversationTitle ??
          ([...chat.messages].reverse().find((m) => m.role === "user")?.content?.trim().slice(0, 24) ||
            null),
        messages: chat.messages,
        busy,
        streaming: chat.streaming,
        phase: telemetry.phase,
        status: telemetry.status,
        plan: telemetry.plan,
        activity: telemetry.activity,
        sources: telemetry.sources,
        approval: approval ?? telemetry.approval,
        suggestions: telemetry.suggestions,
        conversations,
        transitioning: conversationTransitioning,
        attachments: attachments.views.map((a) => ({ id: a.id, name: a.name, status: a.status })),
        configured: chat.configured,
      }),
    [
      currentConversationId,
      conversationTitle,
      chat.messages,
      busy,
      chat.streaming,
      telemetry,
      approval,
      conversations,
      conversationTransitioning,
      attachments.views,
      chat.configured,
    ]
  );

  // 快照节流发布（订阅 snapshot；无 mini bridge 即全跳过）
  const lastPublishRef = useRef(0);
  useEffect(() => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini) return;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const now = Date.now();
    if (now - lastPublishRef.current >= PUBLISH_THROTTLE_MS) {
      lastPublishRef.current = now;
      try {
        mini.publishState(snapshot);
      } catch {}
    } else {
      trailing = setTimeout(
        () => {
          lastPublishRef.current = Date.now();
          try {
            getClassFlowDesktopMiniBridge()?.publishState(snapshot);
          } catch {}
        },
        PUBLISH_THROTTLE_MS - (now - lastPublishRef.current)
      );
    }
    return () => {
      if (trailing) clearTimeout(trailing);
    };
  }, [snapshot]);

  // 远端发送/停止/会话命令/低风险审批：只订阅一次（回调经 liveRef / store 读最新运行时）
  useEffect(() => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini) return;

    const waitReady = async (): Promise<void> => {
      const start = Date.now();
      for (;;) {
        if (!liveRef.current.attachments.hasProcessing) return;
        if (Date.now() - start > READY_TIMEOUT_MS) return;
        await new Promise((r) => setTimeout(r, READY_POLL_MS));
      }
    };

    const offSend = mini.onRemoteSend((payload) => {
      void (async () => {
        const req = (payload ?? {}) as Partial<MiniRemoteSendRequest>;
        const requestId = typeof req.requestId === "string" ? req.requestId : "";
        const done = (result: unknown) => {
          try {
            getClassFlowDesktopMiniBridge()?.completeRemoteSend(result);
          } catch {
            // 回执丢失 = 迷你窗侧发送挂起：重试一次；仍失败则放弃（主窗已落库，
            // 不重发避免重复，迷你窗侧由自身超时兜底）
            try {
              getClassFlowDesktopMiniBridge()?.completeRemoteSend(result);
            } catch {
              /* 主窗已落库，仅丢回执 */
            }
          }
        };
        if (!requestId) return;
        const live = liveRef.current;
        if (live.chat.turnInFlight || live.chat.streaming) {
          done({ ok: false, requestId, code: "BUSY", message: "主窗口正在对话，请稍候。" });
          return;
        }
        const checked = sanitizeMiniSend({ text: req.text, files: req.files });
        if (!checked.ok) {
          done({ ok: false, requestId, code: checked.code, message: checked.message });
          return;
        }
        try {
          if (checked.value.files.length > 0) {
            const files = checked.value.files.map((f) => {
              // base64ToBytes 返回视图需拷贝为 ArrayBuffer-backed（File BlobPart 类型要求）
              const bytes = new Uint8Array(base64ToBytes(f.dataBase64));
              return new File([bytes], f.name, { type: f.type });
            });
            await live.attachments.addFiles(files);
            await waitReady();
          }
          const ok = await liveRef.current.chat.send(checked.value.text);
          if (!ok) {
            done({ ok: false, requestId, code: "SEND_REJECTED", message: "发送未被接受（附件未就绪或模型不可用）。", droppedFiles: checked.value.droppedFiles });
            return;
          }
          done({ ok: true, requestId });
        } catch (error) {
          done({
            ok: false,
            requestId,
            code: "FAILED",
            message: error instanceof Error ? error.message : "发送失败。",
          });
        }
      })();
    });
    const offStop = mini.onRemoteStop(() => {
      try {
        liveRef.current.chat.stop();
      } catch {}
    });
    const offNewChat = mini.onRemoteNewChat(() => {
      const live = liveRef.current;
      if (live.chat.turnInFlight || live.chat.streaming || live.conversationTransitioning) return;
      live.actions.newChat();
    });
    const offSwitch = mini.onRemoteSwitchConversation((id) => {
      const live = liveRef.current;
      if (live.chat.turnInFlight || live.chat.streaming || live.conversationTransitioning) return;
      if (typeof id !== "string" || !id || id === live.currentConversationId) return;
      live.actions.loadConversation(id);
    });
    const offFocus = mini.onRemoteFocusConversation((id) => {
      const live = liveRef.current;
      if (typeof id !== "string" || !id || id === live.currentConversationId) return;
      if (live.chat.turnInFlight || live.chat.streaming || live.conversationTransitioning) return;
      live.actions.loadConversation(id);
    });
    const offApproval = mini.onRemoteApproval((payload) => {
      const p = (payload ?? {}) as { approvalId?: unknown; decision?: unknown };
      const approvalId = typeof p.approvalId === "string" ? p.approvalId : "";
      const decision: ComputerApprovalDecision =
        p.decision === "deny" ? "deny" : "allow-once";
      if (!approvalId) return;
      const current = useKiroComputerRuntimeStore.getState().pendingApproval;
      if (!current || current.id !== approvalId) return;
      if (decision === "allow-once") {
        if (!canApproveInMini(current)) return;
      }
      void liveRef.current.chat.resolveApproval(approvalId, decision);
    });

    return () => {
      offSend();
      offStop();
      offNewChat();
      offSwitch();
      offFocus();
      offApproval();
    };
    // liveTransitioning 是低频 boolean；仅作为闭包最新值保护，避免频繁重订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
