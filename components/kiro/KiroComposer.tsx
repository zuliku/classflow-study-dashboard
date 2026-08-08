"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  AtSign,
  ArrowUp,
  Square,
  Paperclip,
  FileText,
  Image as ImageIcon,
  ChevronDown,
  Settings,
} from "lucide-react";
import { KiroContextBar, KiroContextChip } from "@/components/kiro/KiroContextBar";
import { KiroContextPicker } from "@/components/kiro/KiroContextPicker";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer（Task 1）：真实发送入口。
 * - Enter 发送 / Shift+Enter 换行；empty 或未配置时 Send disabled
 * - streaming 时 Send 变为 Stop
 * - 真实 Model Selector（来自 registry；Custom 显示用户填写的 Model ID）
 * - + 附件菜单：仅 UI（标注「即将支持」，不读取文件）
 * - @ Context Picker：UI foundation（Task 1 不发送给模型）
 */
export function KiroComposer({
  contexts,
  onAddContext,
  onRemoveContext,
  onSend,
  streaming,
  onStop,
  configured,
  modelOptions,
  activeModelName,
  selectedModelId,
  onSelectModel,
  onOpenSettings,
}: {
  contexts: KiroContextChip[];
  onAddContext: (chip: KiroContextChip) => void;
  onRemoveContext: (id: string) => void;
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  configured: boolean;
  modelOptions: { value: string; label: string }[];
  activeModelName: string;
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  const submit = () => {
    const v = text.trim();
    if (!v || streaming) return;
    onSend(v);
    setText("");
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.focus();
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Esc / 点击外部关闭菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAttachOpen(false);
        setModelOpen(false);
        setPickerOpen(false);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (attachRef.current && !attachRef.current.contains(t)) setAttachOpen(false);
      if (modelRef.current && !modelRef.current.contains(t)) setModelOpen(false);
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(t)) setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const attachItems = [
    { id: "file", icon: Paperclip, label: "上传文件", soon: true },
    { id: "material", icon: FileText, label: "选择课程资料", soon: true },
    { id: "image", icon: ImageIcon, label: "添加图片", soon: true },
  ];

  const attachMenu = (
    <div role="menu" aria-label="添加附件" className="py-1">
      {attachItems.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            role="menuitem"
            onClick={() => setAttachOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors"
          >
            <Icon className="w-4 h-4 text-sandrift shrink-0" />
            <span className="flex-1">{it.label}</span>
            <span className="text-[9px] font-bold text-sandrift bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded">
              即将支持
            </span>
          </button>
        );
      })}
      <p className="px-3 pt-1 text-[10px] text-sandrift">附件读取将在后续 Task 提供。</p>
    </div>
  );

  const modelMenu = (
    <div role="menu" aria-label="选择模型" className="py-1">
      {modelOptions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-sandrift">请先在设置中填写模型 ID。</p>
      ) : (
        modelOptions.map((m) => (
          <button
            key={m.value}
            role="menuitem"
            onClick={() => {
              onSelectModel(m.value);
              setModelOpen(false);
            }}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs font-semibold transition-colors",
              m.value === selectedModelId ? "text-charcoal bg-pastel-mint" : "text-satin-grey hover:bg-alabaster"
            )}
          >
            {m.label}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div className="shrink-0" data-testid="kiro-composer">
      <div className="max-w-[820px] mx-auto">
        <KiroContextBar contexts={contexts} onRemove={onRemoveContext} />

        <div className="bg-surface border border-line-strong rounded-2xl shadow-subtle p-2.5 focus-within:border-charcoal transition-colors duration-[var(--motion-fast)]">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask Kiro…"
            aria-label="Ask Kiro"
            className="w-full resize-none bg-transparent px-1.5 pt-1 text-sm text-charcoal placeholder-sandrift focus:outline-none leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <div ref={attachRef} className="relative">
                <button
                  onClick={() => {
                    setAttachOpen((v) => !v);
                    setModelOpen(false);
                    setPickerOpen(false);
                  }}
                  aria-label="添加附件"
                  aria-expanded={attachOpen}
                  aria-haspopup="menu"
                  title="添加附件"
                  className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  <Plus className="w-5 h-5 md:w-4 md:h-4" />
                </button>
                {attachOpen && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-60 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
                    {attachMenu}
                  </div>
                )}
              </div>

              <div ref={pickerWrapRef} className="relative">
                <button
                  onClick={() => {
                    setPickerOpen((v) => !v);
                    setAttachOpen(false);
                    setModelOpen(false);
                  }}
                  aria-label="选择上下文"
                  aria-expanded={pickerOpen}
                  title="添加 ClassFlow 上下文"
                  className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  <AtSign className="w-5 h-5 md:w-4 md:h-4" />
                </button>
                {pickerOpen && (
                  <KiroContextPicker
                    onClose={() => setPickerOpen(false)}
                    onPick={(chip) => {
                      onAddContext(chip);
                      setPickerOpen(false);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div ref={modelRef} className="relative">
                <button
                  onClick={() => {
                    setModelOpen((v) => !v);
                    setAttachOpen(false);
                    setPickerOpen(false);
                  }}
                  aria-label="选择模型"
                  aria-expanded={modelOpen}
                  aria-haspopup="menu"
                  title="选择模型"
                  className="hidden sm:flex items-center gap-1 h-9 px-2.5 rounded-xl text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  {activeModelName}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {modelOpen && (
                  <div className="absolute bottom-full right-0 mb-1.5 w-56 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
                    {modelMenu}
                  </div>
                )}
              </div>

              {streaming ? (
                <button
                  onClick={onStop}
                  aria-label="停止生成"
                  title="停止生成"
                  className="ux-press w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-xl bg-charcoal text-white hover:bg-black transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!text.trim() || !configured}
                  aria-label="发送"
                  title="发送"
                  className="ux-press w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-xl bg-charcoal text-white hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="w-5 h-5 md:w-4 md:h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {!configured ? (
          <div className="flex items-center justify-between gap-2 px-1 mt-2">
            <p className="text-[11px] text-sandrift">先连接一个 AI 服务即可开始使用 Kiro。</p>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              配置 AI 服务
            </button>
          </div>
        ) : (
          <p className="text-[10px] text-sandrift mt-1.5 px-1">
            Kiro 当前可以对话与学习辅助，尚未读取你的 ClassFlow 数据。
          </p>
        )}
      </div>
    </div>
  );
}
