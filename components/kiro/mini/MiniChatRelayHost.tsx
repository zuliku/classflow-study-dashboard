"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useKiroRuntime, useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { getClassFlowDesktopMiniBridge } from "@/lib/desktop/bridge";
import {
  base64ToBytes,
  buildMiniSnapshot,
  sanitizeMiniSend,
  type MiniChatSnapshot,
  type MiniRemoteSendRequest,
} from "@/lib/ai/miniChat/protocol";

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
 * - 远端停止：同一 chat.stop。
 */
export function MiniChatRelayHost() {
  const { chat, attachments } = useKiroRuntime();
  const { currentConversationId } = useKiroSessionMeta();
  const liveRef = useRef({ chat, attachments, currentConversationId });
  liveRef.current = { chat, attachments, currentConversationId };

  const snapshot: MiniChatSnapshot = useMemo(
    () =>
      buildMiniSnapshot({
        conversationId: currentConversationId,
        messages: chat.messages,
        busy: chat.turnInFlight || chat.streaming,
        streaming: chat.streaming,
        attachments: attachments.views.map((a) => ({ id: a.id, name: a.name, status: a.status })),
        configured: chat.configured,
      }),
    [
      currentConversationId,
      chat.messages,
      chat.turnInFlight,
      chat.streaming,
      chat.configured,
      attachments.views,
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

  // 远端发送/停止：只订阅一次（回调经 liveRef 读最新运行时）
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
    return () => {
      offSend();
      offStop();
    };
  }, []);

  return null;
}
