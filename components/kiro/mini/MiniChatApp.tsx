"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Plus } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { getClassFlowDesktopMiniBridge } from "@/lib/desktop/bridge";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { copyTextToClipboard } from "@/lib/ai/share";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  MINI_CAPSULE_SIZE,
  MINI_DEFAULT_SUGGESTIONS,
  MINI_MAX_FILES,
  MINI_MAX_FILE_BYTES,
  MINI_MODE_ANIMATION_MS,
  bytesToBase64,
  type MiniChatConversationSummary,
  type MiniChatSnapshot,
  type MiniChatWindowMode,
} from "@/lib/ai/miniChat/protocol";
import { MiniChatHeader } from "@/components/kiro/mini/MiniChatHeader";
import { MiniChatCapsule } from "@/components/kiro/mini/MiniChatCapsule";
import { MiniChatMorph } from "@/components/kiro/mini/MiniChatMorph";
import { MiniChatStatusStrip } from "@/components/kiro/mini/MiniChatStatusStrip";
import { MiniChatComposer } from "@/components/kiro/mini/MiniChatComposer";
import { MiniMarkdown } from "@/components/kiro/mini/MiniMarkdown";

/**
 * Kiro Mini 窗（`?mini=1` 独立 BrowserWindow 根；瘦客户端，无聊天运行时）：
 * - 只读快照展示（消息 / 状态 / Plan / 来源 / 审批）+ 文本/附件发送意图；
 * - 主窗口执行；Mini 不直连模型、不执行工具、不写数据；
 * - 支持展开态 / 胶囊态、会话切换、系统通知由 Main 负责；
 * - 低风险审批只允许 deny / allow-once，且由主窗口二次校验。
 */
export function MiniChatApp() {
  const miniAvailable = getClassFlowDesktopMiniBridge() !== null;
  const reducedMotion = useEffectiveReducedMotion();
  const initialCapsule =
    typeof window !== "undefined" && window.innerWidth <= MINI_CAPSULE_SIZE + 8;
  const [snapshot, setSnapshot] = useState<MiniChatSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [onTop, setOnTop] = useState(true);
  const [mode, setModeState] = useState<MiniChatWindowMode>(
    initialCapsule ? "capsule" : "expanded"
  );
  /** 非空 = 窗口正在形变；只渲染轻量 morph 层，避免 resize 期间重排聊天界面 */
  const [transitionTo, setTransitionTo] = useState<MiniChatWindowMode | null>(null);
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const busySinceRef = useRef<number | null>(null);
  const previousBusyRef = useRef(false);
  const modeTimerRef = useRef<number | null>(null);

  const busy = snapshot?.busy ?? false;
  const messages = snapshot?.messages ?? [];
  const lastMessageText = messages[messages.length - 1]?.text ?? "";
  const statusLabel = snapshot?.status?.label ?? "";
  const suggestions =
    snapshot?.suggestions && snapshot.suggestions.length > 0
      ? snapshot.suggestions
      : [...MINI_DEFAULT_SUGGESTIONS];
  const configured = snapshot?.configured ?? true;
  const transitioning = snapshot?.transitioning ?? false;
  const title = snapshot?.title ?? "Kiro Mini";
  const noticeText = syncError
    ? "主窗口未连接"
    : transitioning
      ? "正在切换对话…"
      : notice;
  const noticePresence = usePresence(!!noticeText, MOTION_EXIT_MS.panel);
  const busyPresence = usePresence(busy && !!statusLabel, MOTION_EXIT_MS.fast);
  const lastNoticeRef = useRef<string | null>(null);
  if (noticeText) lastNoticeRef.current = noticeText;
  const shownNotice = noticeText ?? lastNoticeRef.current;

  const refreshState = useCallback(async () => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini) return;
    try {
      const state = await mini.getState();
      if (state && typeof state === "object") {
        setSnapshot(state as MiniChatSnapshot);
        setSyncError(false);
      }
    } catch {
      setSyncError(true);
    }
  }, []);

  // 初始快照 + 窗口状态 + 推送订阅（无 bridge 即 fallback，不抛错）
  useEffect(() => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const state = await mini.getState();
        if (!cancelled && state && typeof state === "object") {
          setSnapshot(state as MiniChatSnapshot);
          setSyncError(false);
        }
      } catch {
        if (!cancelled) setSyncError(true);
      }
    };
    void refresh();
    mini
      .getWindowState()
      .then((state) => {
        if (cancelled || !state) return;
        setOnTop(state.onTop !== false);
        // 用户已开始形态切换时尊重状态机，避免异步回包把动画中途打断。
        if (modeTimerRef.current !== null) return;
        setModeState(state.mode === "capsule" ? "capsule" : "expanded");
      })
      .catch(() => {
        void mini
          .isAlwaysOnTop()
          .then((r) => {
            if (!cancelled) setOnTop((r as { onTop?: boolean })?.onTop !== false);
          })
          .catch(() => {});
      });
    const off = mini.onState((state) => {
      if (state && typeof state === "object") {
        setSnapshot(state as MiniChatSnapshot);
        setSyncError(false);
      }
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => {
      setUnread(0);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      off();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // busy 计时（只作为 Header 的轻量 detail；不参与状态推导）
  useEffect(() => {
    if (!busy) {
      busySinceRef.current = null;
      return;
    }
    if (busySinceRef.current === null) busySinceRef.current = Date.now();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsed =
    busy && busySinceRef.current
      ? Math.max(0, Math.floor((now - busySinceRef.current) / 1000))
      : 0;

  // 完成未读：Mini 隐藏/失焦时，turn busy→false → 未读点
  useEffect(() => {
    if (busy) {
      previousBusyRef.current = true;
      return;
    }
    if (previousBusyRef.current) {
      previousBusyRef.current = false;
      if (document.hidden || !document.hasFocus()) {
        setUnread((n) => Math.min(99, n + 1));
      }
    }
  }, [busy]);

  // 审批状态变化后解除本地 busy
  useEffect(() => {
    if (!snapshot?.approval?.pending) setApprovalBusy(false);
  }, [snapshot?.approval?.pending, snapshot?.approval?.id]);

  // 主窗口回执丢失时不要永久禁用审批按钮
  useEffect(() => {
    if (!approvalBusy) return;
    const timer = window.setTimeout(() => setApprovalBusy(false), 8000);
    return () => window.clearTimeout(timer);
  }, [approvalBusy]);

  // 新消息：贴底时跟随；用户上翻时不抢滚动
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = true;
    setHasNew(false);
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth && !reducedMotion ? "smooth" : "auto",
    });
  }, [reducedMotion]);

  useEffect(() => {
    if (stickRef.current) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else if (busy || messages.length > 0) {
      setHasNew(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastMessageText.length, snapshot?.phase]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    stickRef.current = atBottom;
    if (atBottom) setHasNew(false);
  }, []);

  const addFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return;
    setNotice(null);
    setFiles((prev) => {
      const merged = [...prev];
      for (const file of picked) {
        if (merged.length >= MINI_MAX_FILES) {
          setNotice(`附件最多 ${MINI_MAX_FILES} 个`);
          break;
        }
        if (file.size <= 0 || file.size > MINI_MAX_FILE_BYTES) {
          setNotice(`「${file.name}」超过 20MB`);
          continue;
        }
        merged.push(file);
      }
      return merged;
    });
  }, []);

  const sendRemote = useCallback(
    async (text: string, outgoingFiles: File[], clearComposer: boolean) => {
      const mini = getClassFlowDesktopMiniBridge();
      if (!mini || sending) return false;
      const trimmed = text.trim();
      if (!trimmed && outgoingFiles.length === 0) return false;
      if (snapshot?.busy) {
        setNotice("Kiro 正在处理当前对话");
        return false;
      }
      if (snapshot && snapshot.configured === false) {
        setNotice("未配置模型，去主窗口设置");
        return false;
      }
      setSending(true);
      setNotice(null);
      try {
        const payloadFiles = await Promise.all(
          outgoingFiles.map(async (file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
          }))
        );
        const result = (await mini.sendRemote({
          requestId:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `mini_${Date.now().toString(36)}`,
          text: trimmed,
          files: payloadFiles,
        })) as { ok?: boolean; code?: string; message?: string; droppedFiles?: string[] };
        if (!result || result.ok !== true) {
          setNotice(result?.message ?? "发送失败");
          return false;
        }
        if (result.droppedFiles && result.droppedFiles.length > 0) {
          setNotice(`部分附件被忽略：${result.droppedFiles.join("、")}`);
        }
        if (clearComposer) {
          setInput("");
          setFiles([]);
        }
        stickRef.current = true;
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
        return true;
      } catch {
        setNotice("发送失败（主窗口无响应）");
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending, snapshot?.busy, snapshot?.configured]
  );

  const send = useCallback(() => {
    void sendRemote(input, files, true);
  }, [input, files, sendRemote]);

  const quickSend = useCallback(
    (prompt: string) => {
      if (snapshot?.busy || transitioning) {
        setNotice("Kiro 正在处理当前对话");
        return;
      }
      void sendRemote(prompt, [], false);
    },
    [sendRemote, snapshot?.busy, transitioning]
  );

  const setMode = useCallback(
    (next: MiniChatWindowMode) => {
      if (next === mode || transitionTo !== null) return;
      if (modeTimerRef.current !== null) {
        window.clearTimeout(modeTimerRef.current);
        modeTimerRef.current = null;
      }
      setMenuOpen(false);
      if (next === "expanded") setUnread(0);
      const mini = getClassFlowDesktopMiniBridge();
      if (reducedMotion) {
        setModeState(next);
        setTransitionTo(null);
        try {
          mini?.setMode(next, true);
        } catch {}
        return;
      }
      // 先挂轻量 morph 层（与胶囊同一视觉），窗口 bounds 动画期间不再渲染
      // 完整聊天界面；窗口到位后再挂目标形态。
      setTransitionTo(next);
      try {
        mini?.setMode(next, false);
      } catch {}
      modeTimerRef.current = window.setTimeout(() => {
        modeTimerRef.current = null;
        setModeState(next);
        setTransitionTo(null);
      }, MINI_MODE_ANIMATION_MS[next] + 20);
    },
    [mode, reducedMotion, transitionTo]
  );

  useEffect(
    () => () => {
      if (modeTimerRef.current !== null) window.clearTimeout(modeTimerRef.current);
    },
    []
  );

  const hide = useCallback(() => {
    try {
      getClassFlowDesktopMiniBridge()?.hide();
    } catch {}
  }, []);

  const togglePin = useCallback(() => {
    const next = !onTop;
    setOnTop(next);
    try {
      getClassFlowDesktopMiniBridge()?.setAlwaysOnTop(next);
    } catch {}
  }, [onTop]);

  const focusMain = useCallback((conversationId?: string) => {
    try {
      getClassFlowDesktopMiniBridge()?.focusMain(conversationId);
    } catch {}
    setMenuOpen(false);
  }, []);

  const copyMessage = useCallback(async (id: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1200);
  }, []);

  const newChat = useCallback(() => {
    if (busy || transitioning) {
      setNotice("先停止当前回答");
      return;
    }
    setMenuOpen(false);
    try {
      getClassFlowDesktopMiniBridge()?.newChat();
    } catch {}
  }, [busy, transitioning]);

  const switchConversation = useCallback(
    (conversation: MiniChatConversationSummary) => {
      if (busy || transitioning) {
        setNotice("先停止当前回答");
        return;
      }
      if (conversation.id === snapshot?.conversationId) {
        setMenuOpen(false);
        return;
      }
      setMenuOpen(false);
      try {
        getClassFlowDesktopMiniBridge()?.switchConversation(conversation.id);
      } catch {}
    },
    [busy, transitioning, snapshot?.conversationId]
  );

  const resolveApproval = useCallback(
    (decision: "deny" | "allow-once") => {
      const approval = snapshot?.approval;
      if (!approval?.id || approvalBusy) return;
      setApprovalBusy(true);
      try {
        getClassFlowDesktopMiniBridge()?.resolveApproval(approval.id, decision);
      } catch {
        setApprovalBusy(false);
      }
    },
    [approvalBusy, snapshot?.approval]
  );

  // Esc：菜单优先关闭；否则隐藏 Mini
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide, menuOpen]);

  if (!miniAvailable) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface p-6 text-center">
        <p className="text-xs text-sandrift">迷你窗仅在桌面端可用。</p>
      </div>
    );
  }

  if (transitionTo !== null) {
    return (
      <MiniChatMorph
        target={transitionTo}
        durationMs={MINI_MODE_ANIMATION_MS[transitionTo]}
      />
    );
  }

  if (mode === "capsule") {
    return (
      <MiniChatCapsule
        statusLabel={statusLabel}
        busy={busy}
        unread={unread}
        onExpand={() => setMode("expanded")}
        onHide={hide}
      />
    );
  }

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-surface text-charcoal"
      data-testid="kiro-mini-app"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        addFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      <MiniChatHeader
        title={title}
        statusLabel={statusLabel}
        statusDetail={elapsed >= 2 && busy ? `${elapsed}s` : undefined}
        busy={busyPresence.mounted}
        unread={unread}
        onTop={onTop}
        onPin={togglePin}
        onCollapse={() => setMode("capsule")}
        onHide={hide}
        onNewChat={newChat}
        onOpenConversations={() => setMenuOpen((v) => !v)}
      />

      {/* Header 先就位（Logo 与 morph 共享元素对齐），其余内容快速淡入 */}
      <div className="mini-content-enter flex min-h-0 flex-1 flex-col">
        <MiniChatStatusStrip
          plan={snapshot?.plan ?? null}
          activity={snapshot?.activity ?? null}
          approval={snapshot?.approval ?? null}
          sources={snapshot?.sources ?? []}
          approvalBusy={approvalBusy}
          onApprove={() => resolveApproval("allow-once")}
          onDeny={() => resolveApproval("deny")}
          onFocusMain={() => focusMain(snapshot?.conversationId ?? undefined)}
        />

        <div className="relative min-h-0 flex-1">
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="h-full space-y-2 overflow-y-auto px-3 py-2.5"
            data-testid="kiro-mini-messages"
          >
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center animate-enter">
                <KiroMark size="sm" />
                <p className="text-xs font-semibold">有什么要处理的？</p>
                <p className="text-[10px] text-sandrift">直接问，或拖入文件</p>
              </div>
            )}
            {messages.map((message, index) => {
              if (message.role === "assistant" && !message.text) return null;
              const isLast = index === messages.length - 1;
              return (
                <div
                  key={message.id}
                  data-testid="kiro-mini-message"
                  className={cn(
                    "max-w-full text-[13px] leading-relaxed animate-enter",
                    message.role === "user"
                      ? "ml-6 rounded-xl bg-alabaster/70 px-2.5 py-2 whitespace-pre-wrap break-words"
                      : "mr-2"
                  )}
                >
                  {message.role === "assistant" ? (
                    <>
                      <MiniMarkdown
                        text={message.text}
                        streaming={
                          isLast &&
                          busy &&
                          snapshot?.phase === "answering" &&
                          message.streaming === true
                        }
                      />
                      {isLast && !busy && message.text && (
                        <button
                          type="button"
                          onClick={() => void copyMessage(message.id, message.text)}
                          className="mini-no-drag mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal"
                          aria-label="复制最后一条回答"
                        >
                          {copiedId === message.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copiedId === message.id ? "已复制" : "复制"}
                        </button>
                      )}
                    </>
                  ) : (
                    message.text
                  )}
                </div>
              );
            })}
          </div>
          {hasNew && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="mini-no-drag absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-satin-grey shadow-subtle animate-enter"
            >
              <ChevronDown className="h-3 w-3" />
              新内容
            </button>
          )}
        </div>

        {dragOver && (
          <div className="pointer-events-none mx-2.5 mb-1.5 rounded-xl border-2 border-dashed border-line-strong bg-alabaster/60 px-3 py-2 text-center text-[11px] font-bold animate-enter">
            释放以添加附件
          </div>
        )}

        {noticePresence.mounted && (
          <ExitCollapse exiting={!noticePresence.visible}>
            <div
              className="flex shrink-0 items-center gap-2 px-3 pb-1 text-[10px] font-semibold text-warning"
              data-testid="kiro-mini-notice"
            >
              <span className="min-w-0 flex-1 truncate">{shownNotice}</span>
              {syncError && (
                <button
                  type="button"
                  onClick={() => void refreshState()}
                  className="mini-no-drag shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-charcoal hover:bg-alabaster"
                >
                  重试
                </button>
              )}
            </div>
          </ExitCollapse>
        )}

        <MiniChatComposer
          input={input}
          onInput={setInput}
          files={files}
          onAddFiles={addFiles}
          onRemoveFile={(file) => setFiles((prev) => prev.filter((f) => f !== file))}
          onSend={send}
          onQuickPrompt={quickSend}
          onStop={() => {
            try {
              getClassFlowDesktopMiniBridge()?.stopRemote();
            } catch {}
          }}
          sending={sending}
          busy={busy}
          configured={configured}
          transitioning={transitioning}
          suggestions={suggestions}
          onFocusMain={() => focusMain(snapshot?.conversationId ?? undefined)}
        />

      </div>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="关闭对话菜单"
            className="absolute inset-0 z-20 cursor-default bg-transparent"
            onClick={() => setMenuOpen(false)}
          />
          <div
            data-testid="kiro-mini-conversation-menu"
            className="absolute inset-x-2 top-12 z-30 max-h-[62%] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-card animate-enter"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-bold text-sandrift">最近对话</span>
              <button
                type="button"
                onClick={() => focusMain(snapshot?.conversationId ?? undefined)}
                className="text-[10px] font-semibold text-sandrift hover:text-charcoal"
              >
                主窗口
              </button>
            </div>
            <button
              type="button"
              onClick={newChat}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-charcoal hover:bg-alabaster"
            >
              <Plus className="h-3 w-3" />
              新对话
            </button>
            {(snapshot?.conversations ?? []).map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => switchConversation(conversation)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-alabaster",
                  conversation.id === snapshot?.conversationId
                    ? "font-semibold text-charcoal"
                    : "text-satin-grey"
                )}
              >
                <span className="truncate">{conversation.title}</span>
                {conversation.id === snapshot?.conversationId && (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-charcoal" />
                )}
              </button>
            ))}
            {(snapshot?.conversations ?? []).length === 0 && (
              <p className="px-2 py-3 text-center text-[10px] text-sandrift">暂无历史对话</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
