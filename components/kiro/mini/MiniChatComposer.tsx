"use client";

import React from "react";
import { Paperclip, Plus, SendHorizontal, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MINI_MAX_FILES } from "@/lib/ai/miniChat/protocol";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MiniChatComposer({
  input,
  onInput,
  files,
  onAddFiles,
  onRemoveFile,
  onSend,
  onStop,
  sending,
  busy,
  configured,
  transitioning,
  suggestions,
  onQuickPrompt,
  onFocusMain,
}: {
  input: string;
  onInput: (value: string) => void;
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (file: File) => void;
  onSend: () => void;
  onQuickPrompt: (prompt: string) => void;
  onStop: () => void;
  sending: boolean;
  busy: boolean;
  configured: boolean;
  transitioning: boolean;
  suggestions: string[];
  onFocusMain: () => void;
}) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastFilesRef = React.useRef(files);
  if (files.length > 0) lastFilesRef.current = files;
  const shownFiles = files.length > 0 ? files : lastFilesRef.current;
  const fileTrayPresence = usePresence(files.length > 0, MOTION_EXIT_MS.panel);
  const canSend =
    (input.trim().length > 0 || files.length > 0) &&
    !sending &&
    !busy &&
    !transitioning &&
    configured;

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 112)}px`;
  }, [input]);

  const addPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) onAddFiles(picked);
    event.target.value = "";
  };

  return (
    <div className="shrink-0 border-t border-line p-2">
      {!configured && (
        <button
          type="button"
          onClick={onFocusMain}
          className="mb-1.5 w-full rounded-lg border border-line bg-alabaster/60 px-2 py-1.5 text-left text-[10px] font-semibold text-satin-grey hover:text-charcoal"
        >
          未配置模型，去主窗口设置
        </button>
      )}
      {busy && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-sandrift">
          <span className="truncate">Kiro 正在处理当前对话</span>
          <button
            type="button"
            aria-label="停止"
            onClick={onStop}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-charcoal px-2 text-[10px] font-bold text-white hover:opacity-90"
          >
            <Square className="h-2.5 w-2.5" />
            停止
          </button>
        </div>
      )}

      {suggestions.length > 0 && !busy && (
        <div className="mb-1.5 flex flex-wrap gap-1" data-testid="kiro-mini-suggestions">
          {suggestions.slice(0, 3).map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={!configured || transitioning || sending}
              onClick={() => onQuickPrompt(prompt)}
              className="mini-no-drag rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-satin-grey transition-colors hover:border-line-strong hover:text-charcoal disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {fileTrayPresence.mounted && (
        <ExitCollapse exiting={!fileTrayPresence.visible}>
          <div className="mb-1 flex flex-wrap gap-1" data-testid="kiro-mini-files">
            {shownFiles.map((file) => (
              <span
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-line bg-alabaster/50 py-0.5 pl-1.5 pr-1 text-[10px] animate-enter"
              >
                <Paperclip className="h-3 w-3 shrink-0 text-sandrift" />
                <span className="truncate max-w-[130px] font-semibold">{file.name}</span>
                <span className="shrink-0 text-sandrift">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`移除附件 ${file.name}`}
                  className="mini-no-drag flex h-3.5 w-3.5 items-center justify-center rounded text-sandrift hover:text-charcoal"
                  onClick={() => onRemoveFile(file)}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        </ExitCollapse>
      )}

      <textarea
        ref={taRef}
        value={input}
        rows={1}
        placeholder={transitioning ? "正在切换对话…" : busy ? "等待回答完成…" : "问 Kiro…"}
        aria-label="迷你窗输入"
        disabled={transitioning}
        className="max-h-28 w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-relaxed placeholder-sandrift focus:outline-none disabled:opacity-50"
        onChange={(event) => onInput(event.target.value)}
        onPaste={(event) => {
          const images = Array.from(event.clipboardData?.items ?? [])
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
          if (images.length > 0) {
            event.preventDefault();
            onAddFiles(images);
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
      />

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          <label
            className="mini-no-drag flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
            aria-label="添加附件"
          >
            <Plus className="h-4 w-4" />
            <input type="file" multiple className="hidden" onChange={addPicked} />
          </label>
          {files.length > 0 && (
            <span className="text-[9px] text-sandrift">
              {files.length}/{MINI_MAX_FILES}
            </span>
          )}
        </div>
        {!busy && (
          <button
            type="button"
            aria-label="发送"
            onClick={onSend}
            disabled={!canSend}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-opacity",
              canSend ? "bg-charcoal text-white hover:opacity-90" : "cursor-not-allowed bg-alabaster text-sandrift"
            )}
          >
            <SendHorizontal className="h-3 w-3" />
            {sending ? "发送中" : "发送"}
          </button>
        )}
      </div>
    </div>
  );
}
