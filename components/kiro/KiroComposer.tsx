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
  Loader2,
  Globe2,
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
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
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
  runtimeStatus,
  onStop,
  configured,
  modelOptions,
  activeModelName,
  selectedModelId,
  modelUnavailable,
  activeModelVendor,
  onSelectModel,
  onOpenSettings,
  attachments,
  hasProcessing,
  visionEnabled,
  preparingVision,
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
  /** 返回 true = 已提交（扫描 PDF 渲染失败时 false，Prompt 保留） */
  onSend: (text: string) => Promise<boolean> | boolean;
  streaming: boolean;
  runtimeStatus: "ready" | "submitted" | "streaming" | "error";
  onStop: () => void;
  configured: boolean;
  modelOptions: { value: string; label: string; vendor: AIModelVendor | null }[];
  activeModelName: string;
  selectedModelId: string;
  /** 当前选中模型不在 Catalog（已下线/不可用）：提示重新选择，不自动覆盖 */
  modelUnavailable?: boolean;
  activeModelVendor: AIModelVendor | null;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  attachments: KiroAttachmentView[];
  hasProcessing: boolean;
  visionEnabled: boolean;
  /** 扫描 PDF 页面渲染中（Send 禁用 + 提示） */
  preparingVision?: boolean;
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
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const hasImages = attachments.some((a) => a.kind === "image");
  const imagesBlocked = hasImages && !visionEnabled;
  // 扫描型 PDF 需要 Vision 模型（Task 12）：非 Vision 模型阻止发送，绝不静默丢图
  const needsScannedVision = attachments.some((a) => a.visionRequired === true);
  const scannedBlocked = needsScannedVision && !visionEnabled;
  // Task 14：Kiro Search（Workspace / Sidecar 共用同一 store，开关共享）
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useKiroPreferencesStore((s) => s.setWebSearchEnabled);
  const canSend =
    text.trim().length > 0 &&
    !hasProcessing &&
    !imagesBlocked &&
    !scannedBlocked &&
    !streaming &&
    !submitting &&
    !preparingVision;
  const turnLocked = submitting || streaming;

  useEffect(() => {
    if ((!streaming && runtimeStatus !== "error") || !submittingRef.current) return;
    submittingRef.current = false;
    setSubmitting(false);
  }, [runtimeStatus, streaming]);

  useEffect(() => {
    if (!turnLocked) return;
    setAttachOpen(false);
    setModelOpen(false);
    setPickerOpen(false);
    setMaterialPickerOpen(false);
  }, [turnLocked]);

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  const submit = async () => {
    if (!canSend || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ok = await onSend(text.trim());
      // 只有真正提交（含扫描 PDF 渲染成功）后才清空；失败保留用户 Prompt
      if (!ok) {
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      setText("");
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.style.height = "auto";
          taRef.current.focus();
        }
      });
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      throw error;
    }
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
    if (turnLocked) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onAddFiles(files);
  };

  // 粘贴图片（Ctrl/Cmd+V）
  const handlePaste = (e: React.ClipboardEvent) => {
    if (turnLocked) return;
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
    // 唯一真实滚动容器：支持滚轮/触控板，但视觉隐藏 scrollbar（避免与外层 popup 双滚动条）
    <div
      role="menu"
      aria-label="选择模型"
      className="py-1 max-h-[min(320px,55vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {modelUnavailable && (
        <p className="px-3 py-2 text-[11px] font-semibold text-danger border-b border-line-soft mb-1">
          当前模型已不可用，请重新选择。
        </p>
      )}
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
            {m.value === selectedModelId && <Check className="w-4 h-4 text-charcoal shrink-0" />}
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
      className={cn("shrink-0 relative", compact && "px-3 pb-3")}
      data-testid="kiro-composer"
    >
      {/* 拖拽提示：覆盖 Composer Surface（不覆盖整个 Workspace），轻量 */}
      {dragOver && (
        <div className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-line-strong bg-surface/90 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="text-xs font-bold text-charcoal">释放以添加到 Kiro</span>
        </div>
      )}

      <div className="max-w-[820px] mx-auto">
        {/* Context Bar：Composer 外上方，明确 Kiro 正在使用的数据范围 */}
        <KiroContextBar
          contexts={contexts}
          onRemove={onRemoveContext}
          compact={compact}
          locked={turnLocked}
        />

        {/* Composer Surface：Attachment Shelf（次级层） + Prompt + Toolbar（主层） */}
        <div className="bg-surface border border-line-strong rounded-2xl shadow-subtle focus-within:border-sandrift focus-within:shadow-subtle transition-[border-color,box-shadow] duration-[var(--motion-fast)]">
          {/* Attachment Shelf：无附件时完全不存在 */}
          {attachments.length > 0 && (
            <div
              className={cn(
                "bg-alabaster/40 border-b border-line-soft rounded-t-2xl",
                compact ? "px-2.5 py-1.5" : "px-3 py-2"
              )}
            >
              {/* Tray：单行横向滚动，附件再多也不撑高 Composer */}
              <div
                className="flex items-center gap-1.5 overflow-x-auto kiro-attachment-tray"
                data-testid="kiro-attachments"
              >
                {attachments.map((a) => (
                  <KiroAttachmentChip
                    key={a.id}
                    attachment={a}
                    onRemove={onRemoveAttachment}
                    onRetry={onRetryAttachment}
                    onSaveToCourse={onSaveAttachmentToCourse}
                    disabled={turnLocked}
                  />
                ))}
                {(hasImages && !visionEnabled) || scannedBlocked ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warning px-1.5 whitespace-nowrap">
                    {scannedBlocked ? "扫描型 PDF 需要支持图片理解的模型" : "当前模型不支持图片理解"}
                    <button
                      onClick={() => setModelOpen(true)}
                      className="underline underline-offset-2 decoration-line-strong hover:text-charcoal"
                    >
                      切换模型
                    </button>
                  </span>
                ) : null}
                {preparingVision && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sandrift px-1.5 whitespace-nowrap">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    正在准备扫描 PDF…
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Prompt + Toolbar：统一内部 gutter，prompt 区保持最干净 */}
          <div className={cn(compact ? "px-2.5 pt-2 pb-2" : "px-3 pt-2.5 pb-2.5")}>
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
              className="w-full resize-none bg-transparent text-sm text-charcoal placeholder-sandrift focus:outline-none leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2 pt-1.5">
              <div className="flex items-center gap-0.5">
                <div ref={attachRef} className="relative">
                  <button
                    onClick={() => {
                      if (turnLocked) return;
                      setAttachOpen((v) => !v);
                      setModelOpen(false);
                      setPickerOpen(false);
                      setMaterialPickerOpen(false);
                    }}
                    aria-label="添加附件"
                    aria-expanded={attachOpen}
                    aria-haspopup="menu"
                    disabled={turnLocked}
                    title="添加附件"
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {attachOpen && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-60 max-h-[min(320px,60dvh)] overflow-y-auto bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
                      <KiroAttachmentPicker
                        onClose={() => setAttachOpen(false)}
                        onFiles={onAddFiles}
                        onMaterials={() => setMaterialPickerOpen(true)}
                      />
                    </div>
                  )}
                  {materialPickerOpen && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-72 max-h-[min(320px,60dvh)] overflow-y-auto bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline">
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
                      if (turnLocked) return;
                      setPickerOpen((v) => !v);
                      setAttachOpen(false);
                      setModelOpen(false);
                    }}
                    aria-label="选择上下文"
                    aria-expanded={pickerOpen}
                    title="添加 ClassFlow 上下文"
                    disabled={turnLocked}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <AtSign className="w-4 h-4" />
                  </button>
                  <KiroContextPicker
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    onPick={(ref) => {
                      onAddContext(ref);
                      setPickerOpen(false);
                    }}
                  />
                </div>

                {/* Task 14：Kiro Search（联网搜索）轻量开关——只切换 enabled；V1 = 自动判断 */}
                <button
                  onClick={() => {
                    if (!turnLocked) setWebSearchEnabled(!webSearchEnabled);
                  }}
                  aria-label="联网搜索"
                  aria-pressed={webSearchEnabled}
                  title={webSearchEnabled ? "联网搜索：自动" : "联网搜索：关闭"}
                  disabled={turnLocked}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-xl transition-colors",
                    webSearchEnabled
                      ? "text-charcoal bg-pastel-mint/60 hover:bg-pastel-mint"
                      : "text-sandrift hover:bg-alabaster hover:text-charcoal"
                  )}
                >
                  <Globe2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div ref={modelRef} className="relative">
                  <button
                    onClick={() => {
                      if (turnLocked) return;
                      setModelOpen((v) => !v);
                      setAttachOpen(false);
                      setPickerOpen(false);
                    }}
                    aria-label="选择模型"
                    aria-expanded={modelOpen}
                    aria-haspopup="menu"
                    title="选择模型"
                    disabled={turnLocked}
                    className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    className="ux-press w-9 h-9 flex items-center justify-center rounded-full bg-charcoal text-white hover:bg-black transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                ) : submitting ? (
                  <button
                    type="button"
                    disabled
                    aria-label="正在准备"
                    title="正在准备"
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-charcoal text-white opacity-80 cursor-wait"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={!canSend}
                    aria-label="发送"
                    title="发送"
                    className="ux-press w-9 h-9 flex items-center justify-center rounded-full bg-charcoal text-white hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Composer 下方只保留真正需要用户注意的状态 */}
        {!configured ? (
          <div className={cn("flex items-center justify-between gap-2 mt-2", compact ? "px-0" : "px-0.5")}>
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
          <p className={cn("text-[10px] text-sandrift mt-1.5", compact ? "px-0" : "px-0.5")}>
            文件内容会发送给当前选择的 AI 服务以完成你的请求。
          </p>
        ) : null}
      </div>
    </div>
  );
}
