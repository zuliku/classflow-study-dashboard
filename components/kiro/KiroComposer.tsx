"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  AtSign,
  ArrowUp,
  Square,
  ChevronDown,
  Settings,
  Check,
  Sparkles,
} from "lucide-react";
import { KiroContextBar } from "@/components/kiro/KiroContextBar";
import { KiroContextPicker } from "@/components/kiro/KiroContextPicker";
import { KiroAttachmentPicker } from "@/components/kiro/KiroAttachmentPicker";
import { KiroMaterialPicker } from "@/components/kiro/KiroMaterialPicker";
import { KiroAttachmentChip } from "@/components/kiro/KiroAttachmentChip";
import { ProviderLogo } from "@/components/kiro/ProviderLogo";
import { KiroContextRef } from "@/lib/ai/context/types";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { AIModelVendor } from "@/lib/ai/providers/types";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer（Task 4）：真实发送入口 + 附件（上传/拖拽/粘贴/课程资料/保存）。
 * - 文档：选择后本地解析 → ready 才能发送
 * - 图片：vision 模型以原生 image part 发送；非 vision 模型在发送前阻止
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
  activeModelVendor,
  onSelectModel,
  onOpenSettings,
  attachments,
  hasProcessing,
  visionEnabled,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onSaveAttachmentToCourse,
  onAddMaterial,
  compact,
}: {
  contexts: KiroContextRef[];
  onAddContext: (ref: KiroContextRef) => void;
  onRemoveContext: (key: string) => void;
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  configured: boolean;
  modelOptions: { value: string; label: string; vendor: AIModelVendor | null }[];
  activeModelName: string;
  selectedModelId: string;
  activeModelVendor: AIModelVendor | null;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  attachments: KiroAttachmentView[];
  hasProcessing: boolean;
  visionEnabled: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onSaveAttachmentToCourse: (id: string, courseId: string) => void;
  onAddMaterial: (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => void;
  /** sidecar：更紧凑的密度 */
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const hasImages = attachments.some((a) => a.kind === "image");
  const imagesBlocked = hasImages && !visionEnabled;
  const canSend = text.trim().length > 0 && !hasProcessing && !imagesBlocked && !streaming;

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
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
        setMaterialPickerOpen(false);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (attachRef.current && !attachRef.current.contains(t)) setAttachOpen(false);
      if (modelRef.current && !modelRef.current.contains(t)) setModelOpen(false);
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(t)) {
        setPickerOpen(false);
        setMaterialPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // 拖拽添加文件（Desktop）
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onAddFiles(files);
  };

  // 粘贴图片（Ctrl/Cmd+V）
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length > 0) {
      e.preventDefault();
      onAddFiles(files);
    }
  };

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
              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold transition-colors",
              m.value === selectedModelId ? "text-charcoal bg-pastel-mint" : "text-satin-grey hover:bg-alabaster"
            )}
          >
            <ProviderLogo vendor={m.vendor} size="md" />
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            {m.value === selectedModelId && (
              <span className="w-4 h-4 rounded-full bg-charcoal flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5 text-white" />
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div
      ref={dropRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="shrink-0 relative"
      data-testid="kiro-composer"
    >
      {/* 拖拽提示：轻量，不夸张 */}
      {dragOver && (
        <div className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-line-strong bg-surface/90 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="text-xs font-bold text-charcoal">释放以添加到 Kiro</span>
        </div>
      )}

      <div className="max-w-[820px] mx-auto">
        <KiroContextBar contexts={contexts} onRemove={onRemoveContext} />

        {/* 附件 chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2" data-testid="kiro-attachments">
            {attachments.map((a) => (
              <KiroAttachmentChip
                key={a.id}
                attachment={a}
                onRemove={onRemoveAttachment}
                onRetry={onRetryAttachment}
                onSaveToCourse={onSaveAttachmentToCourse}
              />
            ))}
            {hasImages && !visionEnabled && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warning px-2">
                当前模型不支持图片理解
                <button
                  onClick={() => setModelOpen(true)}
                  className="underline underline-offset-2 decoration-line-strong hover:text-charcoal"
                >
                  切换模型
                </button>
              </span>
            )}
          </div>
        )}

        <div className="bg-surface border border-line-strong rounded-2xl shadow-subtle p-2.5 focus-within:border-charcoal transition-colors duration-[var(--motion-fast)]">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
                    setMaterialPickerOpen(false);
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
                    <KiroAttachmentPicker
                      onClose={() => setAttachOpen(false)}
                      onFiles={onAddFiles}
                      onMaterials={() => setMaterialPickerOpen(true)}
                    />
                  </div>
                )}
                {materialPickerOpen && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
                    <KiroMaterialPicker
                      onClose={() => setMaterialPickerOpen(false)}
                      onPick={(ref) => {
                        onAddMaterial(ref);
                        setMaterialPickerOpen(false);
                        setAttachOpen(false);
                      }}
                    />
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
                    onPick={(ref) => {
                      onAddContext(ref);
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
                  className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  <ProviderLogo vendor={activeModelVendor} size="sm" />
                  <span className="truncate max-w-[140px]">{activeModelName}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </button>
                {modelOpen && (
                  <div className="absolute bottom-full right-0 mb-1.5 w-60 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
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
                  disabled={!canSend}
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
        ) : attachments.length > 0 ? (
          <p className="text-[10px] text-sandrift mt-1.5 px-1">
            文件内容会发送给当前选择的 AI 服务以完成你的请求。
          </p>
        ) : !compact ? (
          <p className="text-[10px] text-sandrift mt-1.5 px-1">
            Kiro 会按需读取完成当前问题所需的 ClassFlow 学习数据；修改操作需要你的明确指令。
          </p>
        ) : null}
      </div>
    </div>
  );
}
