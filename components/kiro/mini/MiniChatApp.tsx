"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Pin, PinOff, Plus, Square, SendHorizontal, Paperclip } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { getClassFlowDesktopMiniBridge } from "@/lib/desktop/bridge";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  MINI_MAX_FILES,
  MINI_MAX_FILE_BYTES,
  bytesToBase64,
  type MiniChatSnapshot,
} from "@/lib/ai/miniChat/protocol";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Kiro Mini 窗（`?mini=1` 独立 BrowserWindow 根；瘦客户端，无聊天运行时）：
 * - 只读快照展示（最近消息 + busy）+ 文本/附件发送意图（经主进程中继到主窗口执行）；
 * -  frameless：头部为原生拖动区（mini-drag-region），按钮均为 mini-no-drag；
 * -  文件拖入/选择：本地 File → base64 → mini:send；附件管线（解析/预算）复用主窗口。
 */
export function MiniChatApp() {
  const miniAvailable = getClassFlowDesktopMiniBridge() !== null;
  const [snapshot, setSnapshot] = useState<MiniChatSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [onTop, setOnTop] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // 常驻窗动效：拖拽/附件/提示对称进退，时长全部走 Contract 常量。
  const dragPresence = usePresence(dragOver, MOTION_EXIT_MS.fast);
  const noticePresence = usePresence(notice !== null, MOTION_EXIT_MS.panel);
  // busy 由快照驱动（early return 之前只能读 snapshot，不能读派生 busy）。
  const busyPresence = usePresence(snapshot?.busy ?? false, MOTION_EXIT_MS.fast);
  // 附件 chip 原位退出（Composer 同模式；发送清空直接过滤，不过渡）。
  const reducedMotion = useEffectiveReducedMotion();
  const [leavingFileKeys, setLeavingFileKeys] = useState<ReadonlySet<string>>(new Set());
  const leavingTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      leavingTimersRef.current.forEach((t) => window.clearTimeout(t));
      leavingTimersRef.current = [];
    },
    []
  );
  const fileKey = (f: File, i: number) => `${f.name}-${f.size}-${f.lastModified}-${i}`;
  // 按对象标识删除（下标在并发删除时会漂移；leaving key 用渲染期下标，快照级一致即可）。
  const removeFile = useCallback(
    (key: string, file: File) => {
      if (leavingFileKeys.has(key)) return;
      if (reducedMotion) {
        setFiles((prev) => prev.filter((f) => f !== file));
        return;
      }
      setLeavingFileKeys((prev) => new Set(prev).add(key));
      const timer = window.setTimeout(() => {
        leavingTimersRef.current = leavingTimersRef.current.filter((t) => t !== timer);
        setLeavingFileKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFiles((prev) => prev.filter((f) => f !== file));
      }, MOTION_EXIT_MS.panel);
      leavingTimersRef.current.push(timer);
    },
    [leavingFileKeys, reducedMotion]
  );
  // 删最后一个文件时整架与 chip 并行收（Composer shelf 同语义）：open 判定排除 leaving，
  // 落库与卸载同 tick 且已零高度，避免“chip 先收、落库后盒子再折”的两段割裂
  const trayPresence = usePresence(
    files.some((f, i) => !leavingFileKeys.has(fileKey(f, i))),
    MOTION_EXIT_MS.panel
  );

  // 初始快照 + 订阅推送（无 bridge 即 fallback，不抛错）
  useEffect(() => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini) return;
    let cancelled = false;
    mini
      .getState()
      .then((s) => {
        if (!cancelled && s && typeof s === "object") setSnapshot(s as MiniChatSnapshot);
      })
      // 首屏快照失败必须可见：否则空白 + 状态错且无感知
      .catch(() => {
        if (!cancelled) setNotice("迷你窗状态同步失败，显示可能不是最新，可关闭重开。");
      });
    mini
      .isAlwaysOnTop()
      .then((r) => {
        if (!cancelled) setOnTop((r as { onTop?: boolean })?.onTop !== false);
      })
      .catch(() => {
        if (!cancelled) setNotice("迷你窗置顶状态读取失败，可手动调整。");
      });
    const off = mini.onState((s) => {
      if (s && typeof s === "object") setSnapshot(s as MiniChatSnapshot);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // 新消息：贴底时跟随到底（用户上翻时不抢滚动）
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [snapshot?.messages.length, snapshot?.updatedAt]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }, []);

  const addPickedFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return;
    setNotice(null);
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of picked) {
        if (merged.length >= MINI_MAX_FILES) {
          setNotice(`附件最多 ${MINI_MAX_FILES} 个，多余的已忽略。`);
          break;
        }
        if (f.size <= 0 || f.size > MINI_MAX_FILE_BYTES) {
          setNotice(`「${f.name}」超出大小限制（20MB），已忽略。`);
          continue;
        }
        merged.push(f);
      }
      return merged;
    });
  }, []);

  const send = useCallback(async () => {
    const mini = getClassFlowDesktopMiniBridge();
    if (!mini || sending) return;
    const text = input.trim();
    if (!text && files.length === 0) return;
    if (snapshot?.busy) {
      setNotice("主窗口正在对话，请稍候。");
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const payloadFiles = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          dataBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
        }))
      );
      const result = (await mini.sendRemote({
        requestId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `mini_${Date.now().toString(36)}`,
        text,
        files: payloadFiles,
      })) as { ok?: boolean; code?: string; message?: string; droppedFiles?: string[] };
      if (!result || result.ok !== true) {
        setNotice(result?.message ?? "发送失败，请重试。");
        return;
      }
      if (result.droppedFiles && result.droppedFiles.length > 0) {
        setNotice(`部分附件被忽略：${result.droppedFiles.join("、")}`);
      }
      setInput("");
      setFiles([]);
      stickRef.current = true;
      requestAnimationFrame(() => taRef.current?.focus());
    } catch {
      setNotice("发送失败（主窗口无响应），请重试。");
    } finally {
      setSending(false);
    }
  }, [files, input, sending, snapshot?.busy]);

  const stop = useCallback(() => {
    try {
      getClassFlowDesktopMiniBridge()?.stopRemote();
    } catch {}
  }, []);

  if (!miniAvailable) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface p-6 text-center">
        <p className="text-xs text-sandrift">迷你窗仅在 ClassFlow 桌面端可用。</p>
      </div>
    );
  }

  const busy = snapshot?.busy ?? false;
  const messages = snapshot?.messages ?? [];
  const canSend = (input.trim().length > 0 || files.length > 0) && !sending && !busy;

  return (
    <div
      className="h-screen flex flex-col bg-surface text-charcoal overflow-hidden"
      data-testid="kiro-mini-app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addPickedFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      {/* 头部：原生拖动区（-webkit-app-region: drag；按钮 no-drag） */}
      <div
        className="mini-drag-region shrink-0 flex items-center gap-2 pl-3 pr-1.5 h-11 border-b border-line bg-surface select-none"
        data-testid="kiro-mini-header"
      >
        <KiroMark size="sm" />
        <span className="text-[13px] font-bold flex-1 truncate">Kiro Mini</span>
        {busyPresence.mounted && (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-semibold text-sandrift transition-[opacity,transform]",
              busyPresence.visible
                ? "opacity-100 duration-[var(--motion-fast)]"
                : "opacity-0 pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
            )}
            data-testid="kiro-mini-busy"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sandrift animate-pulse" />
            对话中
          </span>
        )}
        <button
          type="button"
          aria-label={onTop ? "取消置顶" : "置顶显示"}
          title={onTop ? "取消置顶" : "置顶显示"}
          className="mini-no-drag w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          onClick={() => {
            const next = !onTop;
            setOnTop(next);
            try {
              getClassFlowDesktopMiniBridge()?.setAlwaysOnTop(next);
            } catch {}
          }}
        >
            <span key={String(onTop)} className="ux-fade inline-flex">
              {onTop ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </span>
        </button>
        <button
          type="button"
          aria-label="隐藏迷你窗"
          title="隐藏（主窗口可重新打开）"
          className="mini-no-drag w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          onClick={() => {
            try {
              getClassFlowDesktopMiniBridge()?.hide();
            } catch {}
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 消息区（只读；富卡片保留在主窗口） */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2" data-testid="kiro-mini-messages">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center animate-enter">
            <KiroMark size="sm" />
            <p className="text-xs font-semibold">在主窗口继续，或直接在这里问</p>
            <p className="text-[11px] text-sandrift">文件可直接拖入输入框作为附件</p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-full rounded-xl px-2.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words animate-enter",
              m.role === "user" ? "ml-6 bg-alabaster/70" : "mr-6 bg-surface-soft border border-line-soft"
            )}
          >
            <div className="text-[10px] font-bold text-sandrift pb-0.5">{m.role === "user" ? "你" : "Kiro"}</div>
            <div>{m.text}</div>
          </div>
        ))}
      </div>

      {dragPresence.mounted && (
        <div
          className={cn(
            "mx-2.5 mb-1.5 rounded-xl border-2 border-dashed border-line-strong bg-alabaster/60 px-3 py-2 text-center text-[11px] font-bold pointer-events-none transition-[opacity,transform]",
            dragPresence.visible
              ? "opacity-100 duration-[var(--motion-fast)]"
              : "opacity-0 scale-[0.99] duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
          )}
        >
          释放以添加附件
        </div>
      )}

      {/* 本地待发送附件：整架对称进退，单 chip 原位 collapse 后删除 */}
      {trayPresence.mounted && (
        <ExitCollapse exiting={!trayPresence.visible}>
          <div className="shrink-0 px-2.5 pb-1 flex flex-wrap gap-1" data-testid="kiro-mini-files">
            {files.map((f, i) => {
              const key = fileKey(f, i);
              return (
                <ExitCollapse key={key} axis="horizontal" exiting={leavingFileKeys.has(key)} className="shrink-0">
                  <span className="inline-flex items-center gap-1 max-w-full rounded-lg border border-line bg-alabaster/50 pl-1.5 pr-1 py-0.5 text-[11px]">
                    <Paperclip className="w-3 h-3 text-sandrift shrink-0" />
                    <span className="truncate max-w-[140px] font-semibold">{f.name}</span>
                    <span className="text-sandrift shrink-0">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      aria-label={`移除附件 ${f.name}`}
                      className="mini-no-drag w-4 h-4 flex items-center justify-center rounded text-sandrift hover:text-charcoal"
                      onClick={() => removeFile(key, f)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                </ExitCollapse>
              );
            })}
          </div>
        </ExitCollapse>
      )}

      {noticePresence.mounted && (
        <ExitCollapse exiting={!noticePresence.visible}>
          <div className="shrink-0 px-3 pb-1 text-[11px] font-semibold text-warning" data-testid="kiro-mini-notice">
            {notice}
          </div>
        </ExitCollapse>
      )}

      {/* 输入区 */}
      <div className="shrink-0 border-t border-line p-2">
        <textarea
          ref={taRef}
          value={input}
          rows={2}
          placeholder="问 Kiro…（Enter 发送，Shift+Enter 换行）"
          aria-label="迷你窗输入"
          className="w-full resize-none bg-transparent text-[13px] leading-relaxed placeholder-sandrift focus:outline-none max-h-28"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <label
              className="mini-no-drag w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors cursor-pointer"
              title="添加附件"
              aria-label="添加附件"
            >
              <Plus className="w-4 h-4" />
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPickedFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            {snapshot && snapshot.attachments.length > 0 && (
              <span className="text-[10px] text-sandrift" title={snapshot.attachments.map((a) => a.name).join("、")}>
                主窗口附件 {snapshot.attachments.length} 个
              </span>
            )}
          </div>
          {busy ? (
            <button
              type="button"
              aria-label="停止"
              onClick={stop}
              className="h-8 px-3 rounded-lg bg-charcoal text-white text-xs font-bold flex items-center gap-1.5 hover:opacity-90"
            >
              <Square className="w-3 h-3" />
              停止
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送"
              onClick={() => void send()}
              disabled={!canSend}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-opacity",
                canSend ? "bg-charcoal text-white hover:opacity-90" : "bg-alabaster text-sandrift cursor-not-allowed"
              )}
            >
              <SendHorizontal className="w-3 h-3" />
              {sending ? "发送中" : "发送"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
