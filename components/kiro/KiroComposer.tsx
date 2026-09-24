"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, Settings, Loader2 } from "lucide-react";
import { KiroSendControl } from "@/components/kiro/KiroSendControl";
import { KiroContextBar } from "@/components/kiro/KiroContextBar";
import { KiroAttachmentChip } from "@/components/kiro/KiroAttachmentChip";
import { KiroComposerAddMenu } from "@/components/kiro/composer/KiroComposerAddMenu";
import {
  KiroComposerAccessControl,
  type KiroComposerPermissionSummary,
} from "@/components/kiro/composer/KiroComposerAccessControl";
import { KiroComposerModelControl } from "@/components/kiro/composer/KiroComposerModelControl";
import { KiroComposerReasoningControl } from "@/components/kiro/composer/KiroComposerReasoningControl";
import { KiroComposerContextUsage } from "@/components/kiro/composer/KiroComposerContextUsage";
import type { ContextUsageSnapshot } from "@/lib/ai/contextBudget/usage";
import {
  composerAccessAgentMode,
  composerAccessRequiresComputer,
  type KiroComposerAccessMode,
} from "@/components/kiro/composer/KiroComposerAccess";
import { KiroContextRef } from "@/lib/ai/context/types";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { AIModelVendor } from "@/lib/ai/providers/types";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import { PopoverPanel } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";
import { filterSlashSkills, moveSlashIndex, parseSlashQuery, toSlashSkillOptions } from "@/lib/ai/skills/slashMenu";

/** P3：Composer 只允许一个菜单同时打开（add / access / model） */
type ComposerMenu = "add" | "access" | "reasoning" | "model" | "contextUsage" | null;

/**
 * Kiro Composer（Task 4 / P3 Productization）：真实发送入口 + 附件（上传/拖拽/粘贴/课程资料/保存）。
 * - 一级工具栏收敛为四入口：＋（Add / 来源）· 访问（Access）· 模型（Model · Reasoning）· 发送
 * - 文档：选择后本地解析 → ready 才能发送；图片：vision 模型以原生 image part 发送
 */
export function KiroComposer({
  contexts,
  onAddContext,
  onRemoveContext,
  onSend,
  streaming,
  turnInFlight,
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
  preparingSend,
  turnIntentFrozen,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onSaveAttachmentToCourse,
  onAddMaterial,
  compact,
  // Kiro Computer Agent V1：Computer 模式控制（owner = KiroChatSurface 订阅 stores）
  computerEnabled,
  onToggleComputer,
  agentMode,
  onSetAgentMode,
  reasoningCapability,
  reasoningEffort,
  onSetReasoningEffort,
  workspace,
  workspaceIsSandbox,
  grantWarning,
  permissionSummary,
  onOpenAgentSettings,
  contextUsage,
  contextOverflow,
  contextWindowTokens,
  introActive = false,
}: {
  contexts: KiroContextRef[];
  onAddContext: (ref: KiroContextRef) => void;
  onRemoveContext: (key: string) => void;
  /** 返回 true = 已提交（扫描 PDF 渲染失败时 false，Prompt 保留） */
  onSend: (text: string) => Promise<boolean> | boolean;
  streaming: boolean;
  /** Streaming UX V3：真实 turn lifecycle（submitted / streaming / awaiting-tool-result / awaiting-continuation） */
  turnInFlight: boolean;
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
  /** V4.6：Send 已 claim、preflight 进行中（SDK 尚未接管；Send 禁用 + 「正在准备」，Stop 不出现） */
  preparingSend?: boolean;
  /** V4.6：Turn Intent 已同步冻结（preparing 且已冻结 → 下一 Turn preferences 可编辑） */
  turnIntentFrozen?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onSaveAttachmentToCourse: (id: string, courseId: string) => void;
  onAddMaterial: (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => void;
  /** sidecar：更紧凑的密度 */
  compact?: boolean;
  /** Computer Agent ON（active 样式 + workspace strip + agent mode） */
  computerEnabled?: boolean;
  /** Computer toggle（无 workspace 时由 owner 引导授权流程，不直接启用） */
  onToggleComputer?: (enabled: boolean) => void;
  agentMode?: KiroAgentMode;
  onSetAgentMode?: (mode: KiroAgentMode) => void;
  /** capability-driven reasoning（fixed 时 Composer 不显示 chip） */
  reasoningCapability?: ReasoningCapability;
  reasoningEffort?: KiroReasoningEffort;
  onSetReasoningEffort?: (effort: KiroReasoningEffort) => void;
  workspace?: KiroWorkspaceMeta | null;
  workspaceIsSandbox?: boolean;
  grantWarning?: string | null;
  /** P3：Access Menu 的权限摘要（只含 boolean preference，不含 runtime 事实） */
  permissionSummary?: KiroComposerPermissionSummary;
  /** P3：管理 Agent 权限…（设置 → Agent 与权限） */
  onOpenAgentSettings?: () => void;
  /** 上下文占用快照（Codex-style ring；只展示，不参与任何预算决策） */
  contextUsage?: ContextUsageSnapshot | null;
  /** 本 Turn 因超出输入预算失败（danger 状态） */
  contextOverflow?: boolean;
  /** 官方可核实的模型窗口（Phase 2；缺失 → 不显示「模型窗口 %」） */
  contextWindowTokens?: number;
  /** Motion V1：本轮 Empty Intro claim 成功后 Composer 轻进入（workspace/sidecar 各自 timing scope） */
  introActive?: boolean;
}) {
  const [text, setText] = useState("");
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slashSkills, setSlashSkills] = useState<{ name: string; description: string }[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  const submittingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const addRef = useRef<HTMLDivElement | null>(null);
  const accessRef = useRef<HTMLDivElement | null>(null);
  const contextUsageRef = useRef<HTMLDivElement | null>(null);
  const reasoningRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const hasImages = attachments.some((a) => a.kind === "image");
  // V1.1：建议 chips 只在「真实 ready」的图片存在时出现（processing 图片不算）
  const hasReadyImages = attachments.some((a) => a.kind === "image" && a.status === "ready");
  const imagesBlocked = hasImages && !visionEnabled;
  // 扫描型 PDF 需要 Vision 模型（Task 12）：非 Vision 模型阻止发送，绝不静默丢图
  const needsScannedVision = attachments.some((a) => a.visionRequired === true);
  const scannedBlocked = needsScannedVision && !visionEnabled;
  // Task 14：Kiro Search（Workspace / Sidecar 共用同一 store，开关共享）
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useKiroPreferencesStore((s) => s.setWebSearchEnabled);
  // Task B V1.1：截图隐私提示改为显式 dismiss（不再自动标记；用户没点「知道了」就下次继续提示）
  const visualPrivacyNoticeSeen = useKiroPreferencesStore((s) => s.visualAttachmentPrivacyNoticeSeen);
  const setVisualPrivacyNoticeSeen = useKiroPreferencesStore((s) => s.setVisualAttachmentPrivacyNoticeSeen);
  const canSend =
    text.trim().length > 0 &&
    !hasProcessing &&
    !imagesBlocked &&
    !scannedBlocked &&
    !turnInFlight &&
    !preparingSend &&
    !submitting &&
    !preparingVision;
  // Task 07: Slash Skill — 仅显示 enabled skills；仅「输入中的命令」展开（选中后带空格 → 自动折叠）
  useEffect(() => {
    const query = parseSlashQuery(text);
    if (query === null) {
      setSlashOpen(false);
      return;
    }
    const bridge = (window as unknown as { classflowDesktop?: { skills?: { list: () => Promise<{ skills: { name: string; description: string; enabled: boolean; kind?: string }[] }> } } }).classflowDesktop?.skills;
    if (!bridge) {
      setSlashOpen(false);
      return;
    }
    bridge
      .list()
      .then((res) => {
        // S1：只展示 Workflow Skill（kind 为 canonical 字段；Recipe 不进入 Slash 菜单）
        const workflows = toSlashSkillOptions(res.skills ?? []);
        const filtered = filterSlashSkills(workflows, query);
        setSlashSkills(filtered);
        setSlashActive(0);
        setSlashOpen(filtered.length > 0);
      })
      .catch(() => setSlashOpen(false));
  }, [text]);

  const handleSlashSelect = (name: string) => {
    // 尾随空格 = 命令已完成：菜单折叠且不会因 text 变化重新弹出
    setText(`/${name} `);
    setSlashOpen(false);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autoGrow();
    });
  };

  // V4.1（Productization）+ V4.6：拆分「当前 Turn scope 锁」与「下一 Turn preference 锁」。
  // - currentTurnScopeLocked：Agent Turn 尚未真正 settled——保护 Context/Attachment/Workspace/Computer 等
  //   会改变「当前工作范围」展示的控件（preparing 阶段同样属于当前 Turn 范围）
  // - nextTurnPreferencesLocked：preparing 且 intent 尚未冻结时锁定 Model/Reasoning/AgentMode/WebSearch；
  //   intent 已冻结（或 turn 已开始）→ 可编辑（只影响下一 Turn；当前 Turn 使用冻结 snapshot）。
  //   local submitting 不参与该锁（preparingSend 已覆盖同一窗口；intent 冻结后立即解锁）
  const currentTurnScopeLocked = turnInFlight || submitting || !!preparingSend;
  const nextTurnPreferencesLocked = !!preparingSend && !turnIntentFrozen;

  // Turn scope 锁定期间：scope 类条目在 Add Menu 内部禁用（不整单锁定——联网搜索是下一 Turn preference）；
  // slash 菜单属于当前输入，同样关闭。Access / Model 菜单是 preference 或状态摘要，保持可用。
  useEffect(() => {
    if (!currentTurnScopeLocked) return;
    setSlashOpen(false);
  }, [currentTurnScopeLocked]);

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  // V4.6：local submitting 只表达「Composer submit() 正在 await onSend」——由 onSend 的
  // 返回值决定是否清空 prompt；不再用 runtime streaming/status 反向修改 local submit
  // ownership（sendClaimed 是 preflight claim，不是模型在 streaming）。
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
      // 真实 request 已交给 onSend（chatSendMessage）→ 后续 disable 由 turnInFlight / preparingSend 负责
      submittingRef.current = false;
      setSubmitting(false);
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      throw error;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash 菜单键盘导航优先（避免 Enter 直接发送未完成的 /命令）
    if (slashOpen && slashSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashActive((i) => moveSlashIndex(i, 1, slashSkills.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashActive((i) => moveSlashIndex(i, -1, slashSkills.length));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = slashSkills[slashActive] ?? slashSkills[0];
        if (target) handleSlashSelect(target.name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Esc / 点击外部关闭菜单（P3：单一 openMenu ownership）。
  // Esc 用 capture 阶段：菜单打开时先关闭菜单并阻止继续传播（不误触发 Navigator / Inspector 的 Esc 行为）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenMenu((current) => {
        if (current === null) return current;
        e.stopPropagation();
        return null;
      });
      setSlashOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // 菜单内部（含任意菜单容器）一律视为 inside：菜单内容自己 stopPropagation 之外的兜底
      const target = t as HTMLElement | null;
      const insideMenu = !!target?.closest?.("[data-kiro-composer-menu]");
      const inside =
        insideMenu ||
        (addRef.current?.contains(t) ?? false) ||
        (accessRef.current?.contains(t) ?? false) ||
        (contextUsageRef.current?.contains(t) ?? false) ||
        (reasoningRef.current?.contains(t) ?? false) ||
        (modelRef.current?.contains(t) ?? false);
      if (!inside) setOpenMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // 拖拽添加文件（Desktop）
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (currentTurnScopeLocked) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onAddFiles(files);
  };

  // 粘贴图片（Ctrl/Cmd+V）
  const handlePaste = (e: React.ClipboardEvent) => {
    if (currentTurnScopeLocked) return;
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

  // P3：Access 模式选择（chat = 关闭 Computer；其余 = 开启 Computer + 写入 Agent Mode）
  const selectAccessMode = (mode: KiroComposerAccessMode) => {
    if (!composerAccessRequiresComputer(mode)) {
      onToggleComputer?.(false);
      return;
    }
    if (!computerEnabled) onToggleComputer?.(true);
    const nextAgentMode = composerAccessAgentMode(mode);
    if (nextAgentMode) onSetAgentMode?.(nextAgentMode);
  };

  const resolvedPermissions: KiroComposerPermissionSummary = permissionSummary ?? {
    terminal: false,
    desktopObserve: false,
    desktopAction: false,
    clipboard: false,
  };

  return (
    <div
      ref={dropRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      // z-20：surface 的 focus-within transform（morph）会创建内部 stacking context，
      // 若不在此给 Composer 建立高于 EmptyState（z-10）的层，Attachment/Context 等 popup（z-40）
      // 会被空态遮罩拦截点击（V1.5.1 交互回归修复）
      className={cn("shrink-0 relative z-20", compact && "px-3 pb-3")}
      data-testid="kiro-composer"
    >
      {/* 拖拽提示：覆盖 Composer Surface（不覆盖整个 Workspace），轻量 */}
      {dragOver && (
        <div className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-line-strong bg-surface/90 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="text-xs font-bold text-charcoal">释放以添加到 Kiro</span>
        </div>
      )}

      <div className="max-w-[820px] mx-auto">
        {/* Context Bar：Composer 外上方，只表达「Kiro 本 Turn 明确使用的 ClassFlow Context」。
            P3：Workspace / 授权状态已迁入 Access Menu，不再常驻 chip。 */}
        <KiroContextBar
          contexts={contexts}
          onRemove={onRemoveContext}
          compact={compact}
          locked={currentTurnScopeLocked}
        />

        {/* Composer Surface：Attachment Shelf（次级层） + Prompt + Toolbar（主层）。
            focus 仅保留 border 变色（无阴影 / 无浮起，输入时画面稳定） */}
        <div
          className={cn(
            "bg-surface border border-line-strong rounded-2xl shadow-subtle",
            "focus-within:border-sandrift",
            "transition-[border-color] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
            introActive && "kiro-composer-intro"
          )}
        >
          {/* Attachment Shelf：无附件时完全不存在（BUG-G8：入场 structure-settle） */}
          {attachments.length > 0 && (
            <div
              className={cn(
                "kiro-structure-settle bg-alabaster/40 border-b border-line-soft rounded-t-2xl",
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
                    disabled={currentTurnScopeLocked}
                  />
                ))}
                {(hasImages && !visionEnabled) || scannedBlocked ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warning px-1.5 whitespace-nowrap">
                    {scannedBlocked ? "扫描型 PDF 需要支持图片理解的模型" : "当前模型不支持图片理解"}
                    <button
                      onClick={() => setOpenMenu("model")}
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
              {/* Task B V1.1：截图就绪（ready + vision + 无 processing）+ 输入为空时显示 intent chips。
                  点击只填 prompt（不直接 Send；发送必须走 canonical submit() 的 canSend/vision gate/防重复） */}
              {hasReadyImages && visionEnabled && !hasProcessing && !currentTurnScopeLocked && text.trim().length === 0 && (
                <div className="flex items-center gap-1.5 pt-1.5">
                  {["处理截图通知", "整理任务与 DDL", "识别课程变动"].map((label) => (
                    <button
                      key={label}
                      type="button"
                      data-testid="visual-suggestion"
                      onClick={() => {
                        setText(label);
                        requestAnimationFrame(() => {
                          if (taRef.current) {
                            taRef.current.focus();
                            autoGrow();
                          }
                        });
                      }}
                      className="ux-press flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F5F5] text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors px-2 h-6 whitespace-nowrap"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Slash Skill Menu：仅「输入中的命令」展开；无演示文案；选中项高亮 + 键盘导航 */}
          {slashOpen && (
            <div
              data-testid="skill-slash-menu"
              className={cn(
                "kiro-slash-enter mx-2.5 mt-2.5 mb-0.5 bg-surface border border-line rounded-xl shadow-subtle overflow-hidden",
                compact && "mx-2"
              )}
            >
              <div
                role="listbox"
                aria-label="Skills"
                className="max-h-44 overflow-y-auto overscroll-contain py-1"
              >
                {slashSkills.map((s, index) => {
                  const active = index === slashActive;
                  return (
                    <button
                      key={s.name}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSlashActive(index)}
                      onClick={() => handleSlashSelect(s.name)}
                      data-testid={`skill-slash-item-${s.name}`}
                      className={cn(
                        "w-full text-left px-3 py-2 flex flex-col gap-1 transition-colors duration-[var(--motion-fast)]",
                        active ? "bg-alabaster" : "hover:bg-alabaster/60"
                      )}
                    >
                      <span className="inline-flex w-fit items-center rounded-md border border-line-soft bg-pastel-mint/60 px-1.5 py-0.5 font-mono text-[11px] font-bold text-charcoal">
                        /{s.name}
                      </span>
                      <span className="text-[11px] text-sandrift line-clamp-1 leading-relaxed">
                        {s.description}
                      </span>
                    </button>
                  );
                })}
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
              className={cn(
                "w-full resize-none bg-transparent text-sm text-charcoal placeholder-sandrift focus:outline-none leading-relaxed",
                // Computer Agent ON：输入区稳定最低高度（desktop 64 / compact 44），不随 context strip 压缩
                computerEnabled && (compact ? "min-h-[44px]" : "min-h-[64px]")
              )}
            />

            <div className="flex items-center justify-between gap-2 pt-1.5">
              {/* 左组：＋（内容与来源）· 访问（Computer 范围 / Agent Mode） */}
              <div className="flex items-center gap-1 min-w-0">
                <div ref={addRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenMenu((v) => (v === "add" ? null : "add"))}
                    aria-label="添加"
                    aria-expanded={openMenu === "add"}
                    aria-haspopup="menu"
                    title="添加文件、资料与上下文"
                    data-testid="kiro-composer-add"
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-xl transition-colors",
                      openMenu === "add"
                        ? "bg-alabaster text-charcoal"
                        : "text-sandrift hover:bg-alabaster hover:text-charcoal"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {openMenu === "add" && (
                    <PopoverPanel open placement="top-start" motionProfile="kiro" className="w-60">
                      <KiroComposerAddMenu
                        scopeLocked={currentTurnScopeLocked}
                        preferencesLocked={nextTurnPreferencesLocked}
                        webSearchEnabled={webSearchEnabled}
                        onToggleWebSearch={() => setWebSearchEnabled(!webSearchEnabled)}
                        onFiles={onAddFiles}
                        onAddMaterial={onAddMaterial}
                        onAddContext={onAddContext}
                        onClose={() => setOpenMenu(null)}
                      />
                    </PopoverPanel>
                  )}
                </div>

                <div ref={accessRef} className="relative shrink-0">
                  <KiroComposerAccessControl
                    computerEnabled={!!computerEnabled}
                    agentMode={agentMode ?? "guided"}
                    workspaceName={workspace?.name ?? null}
                    workspaceConfigured={!!workspace}
                    grantWarning={grantWarning ?? null}
                    permissions={resolvedPermissions}
                    scopeLocked={currentTurnScopeLocked}
                    preferencesLocked={nextTurnPreferencesLocked}
                    compact={compact}
                    onSelectMode={selectAccessMode}
                    onOpenAgentSettings={onOpenAgentSettings ?? onOpenSettings}
                    open={openMenu === "access"}
                    onOpenChange={(next) => setOpenMenu(next ? "access" : null)}
                  />
                </div>
              </div>

              {/* 右组：上下文占用（Codex-style ring）+ 思考程度（Codex-style 滑块）+ 模型 + 发送 */}
              <div className="flex items-center gap-1 shrink-0">
                <div ref={contextUsageRef} className="relative shrink-0">
                  <KiroComposerContextUsage
                    snapshot={contextUsage ?? null}
                    overflow={contextOverflow}
                    compact={compact}
                    windowTokens={contextWindowTokens}
                    open={openMenu === "contextUsage"}
                    onOpenChange={(next) => setOpenMenu(next ? "contextUsage" : null)}
                  />
                </div>
                <div ref={reasoningRef} className="relative">
                  <KiroComposerReasoningControl
                    capability={reasoningCapability}
                    effort={reasoningEffort ?? "default"}
                    modelName={activeModelName}
                    disabled={nextTurnPreferencesLocked}
                    compact={compact}
                    onChange={(effort) => onSetReasoningEffort?.(effort)}
                    open={openMenu === "reasoning"}
                    onOpenChange={(next) => setOpenMenu(next ? "reasoning" : null)}
                  />
                </div>
                <div ref={modelRef} className="relative">
                  <KiroComposerModelControl
                    modelOptions={modelOptions}
                    selectedModelId={selectedModelId}
                    activeModelName={activeModelName}
                    activeModelVendor={activeModelVendor}
                    modelUnavailable={modelUnavailable}
                    disabled={nextTurnPreferencesLocked}
                    compact={compact}
                    onSelectModel={onSelectModel}
                    onOpenSettings={onOpenSettings}
                    open={openMenu === "model"}
                    onOpenChange={(next) => setOpenMenu(next ? "model" : null)}
                  />
                </div>

                <KiroSendControl
                  canSend={canSend}
                  preparing={submitting || !!preparingSend}
                  inFlight={turnInFlight}
                  onSend={submit}
                  onStop={onStop}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Composer 下方只保留真正需要用户注意的状态 */}
        {!configured ? (
          <div className={cn("flex items-center justify-end gap-2 mt-2", compact ? "px-0" : "px-0.5")}>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              配置 AI 服务
            </button>
          </div>
        ) : attachments.length > 0 ? (
          <div className={cn("mt-1.5 space-y-1", compact ? "px-0" : "px-0.5")}>
            {/* Task B V1.1：首次添加图片轻提示，显式「知道了」后才不再显示（非 Dialog） */}
            {hasImages && !visualPrivacyNoticeSeen && (
              <p
                data-testid="visual-privacy-notice"
                className="flex items-center gap-2 text-[10px] text-sandrift"
              >
                <span>图片仅用于当前 Kiro 对话，不会自动保存到课程资料。</span>
                <button
                  type="button"
                  data-testid="visual-privacy-dismiss"
                  onClick={() => setVisualPrivacyNoticeSeen(true)}
                  className="flex items-center gap-0.5 px-1.5 h-5 rounded-md text-[10px] font-bold text-satin-grey bg-alabaster border border-line-soft hover:text-charcoal hover:border-line-strong transition-colors"
                >
                  知道了
                </button>
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}



