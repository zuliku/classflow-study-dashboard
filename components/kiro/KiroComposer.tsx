"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, AtSign, ArrowUp, Paperclip, FileText, Image as ImageIcon, ChevronDown } from "lucide-react";
import { KiroContextBar, KiroContextChip } from "@/components/kiro/KiroContextBar";
import { KiroContextPicker } from "@/components/kiro/KiroContextPicker";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer：Task 0 只实现 UI-level 行为。
 * - multiline textarea，auto grow，合理最大高度
 * - Enter 发送（预览） / Shift+Enter 换行
 * - empty 时 Send disabled
 * - + 附件菜单（只实现菜单 UI，不读取文件）
 * - @ Context Picker（读取 Store 实体名称做 UI 展示）
 * - Model selector：静态 placeholder，不伪装已连接
 * 不调用任何网络 / AI。
 */
export function KiroComposer({
  contexts,
  onAddContext,
  onRemoveContext,
  onSend,
}: {
  contexts: KiroContextChip[];
  onAddContext: (chip: KiroContextChip) => void;
  onRemoveContext: (id: string) => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);

  // auto grow：滚动高度随内容增长，上限约 6 行
  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.focus();
      }
    });
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
    { id: "file", icon: Paperclip, label: "上传文件", desc: "本地文件（不读取内容）" },
    { id: "material", icon: FileText, label: "选择课程资料", desc: "从现有课程资料中选择" },
    { id: "image", icon: ImageIcon, label: "添加图片", desc: "粘贴或上传图片" },
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
            className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors"
          >
            <Icon className="w-4 h-4 text-sandrift shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="block">{it.label}</span>
              <span className="block text-[10px] font-medium text-sandrift">{it.desc}</span>
            </span>
          </button>
        );
      })}
      <p className="px-3 pt-1 text-[10px] text-sandrift">界面预览：不会读取或上传文件内容。</p>
    </div>
  );

  const modelMenu = (
    <div role="menu" aria-label="选择模型" className="py-1">
      <p className="px-3 py-2 text-xs text-sandrift">AI 服务将在后续阶段配置。</p>
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
            {/* 左：附件 + 上下文 */}
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

            {/* 右：模型占位 + 发送 */}
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
                  className="hidden sm:flex items-center gap-1 h-9 px-2.5 rounded-xl text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  选择模型
                  <ChevronDown className="w-3 h-3" />
                </button>
                {modelOpen && (
                  <div className="absolute bottom-full right-0 mb-1.5 w-52 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
                    {modelMenu}
                  </div>
                )}
              </div>

              <button
                onClick={submit}
                disabled={!text.trim()}
                aria-label="发送"
                title="发送"
                className="ux-press w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-xl bg-charcoal text-white hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUp className="w-5 h-5 md:w-4 md:h-4" />
              </button>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-sandrift mt-1.5 px-1">
          当前为界面预览，未接入 AI 服务；发送内容仅在本页展示，不会执行任何操作。
        </p>
      </div>
    </div>
  );
}
