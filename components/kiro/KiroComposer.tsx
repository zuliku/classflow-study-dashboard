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
import { useAppStore } from "@/store/useAppStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import { PopoverPanel } from "@/components/ui/Popover";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { usePresence } from "@/lib/usePresence";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { MOTION_EXIT_MS, MOTION_MS } from "@/lib/motion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";
import { filterSlashSkills, moveSlashIndex, parseSlashQuery, toSlashSkillOptions } from "@/lib/ai/skills/slashMenu";
import { tokenizeComposerPrompt } from "@/lib/ai/composer/promptHighlight";
import {
  applyMentionPick,
  buildMentionOptions,
  moveMentionIndex,
  parseMentionQuery,
  type MentionOption,
} from "@/lib/ai/context/mentionMenu";

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
  // Slash 异步竞态守卫：快速输入 /a→/ab 时旧请求先回不得覆盖新查询菜单
  const slashRequestRef = useRef(0);
  const [slashActive, setSlashActive] = useState(0);
  // @ mention：与 Slash 同构的上下文直达入口（选项与 KiroContextListView 同源）
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionActive, setMentionActive] = useState(0);
  // Esc/外部点击读最新菜单状态（listener 只订阅一次，不 stale；关了任一即 stopPropagation，
  // 否则事件继续冒泡到 Sidecar 的 Esc（topmost 判真，因内层菜单未进栈）造成双关）
  const menuStateRef = useRef({ openMenu: null as ComposerMenu, slashOpen: false, mentionOpen: false });
  menuStateRef.current = { openMenu, slashOpen, mentionOpen };
  // P1 对称进退：enter 走既有 keyframe（slash/mention/shelf），exit 走 transition +
  // usePresence 延迟卸载；时长全部引用 Motion Contract 常量（测试有源码护栏）。
  const slashPresence = usePresence(slashOpen, MOTION_EXIT_MS.fast);
  const mentionPresence = usePresence(mentionOpen, MOTION_EXIT_MS.fast);
  const dragPresence = usePresence(dragOver, MOTION_EXIT_MS.fast);
  // 退出窗口内 inert：菜单项/建议 chip/切换按钮在视觉残留期不可 Tab 到达（pointer-events 拦不住键盘）
  const slashInertRef = useInertOnHidden<HTMLDivElement>(!slashPresence.visible);
  const mentionInertRef = useInertOnHidden<HTMLDivElement>(!mentionPresence.visible);
  // 附件 chip 原位退出：点击 × 先 collapse（160ms），再真正删除；
  // 发送清空走父级即时过滤（不保留退出快照），顺序天然保留。
  const reducedMotion = useEffectiveReducedMotion();
  const [leavingAttachmentIds, setLeavingAttachmentIds] = useState<ReadonlySet<string>>(new Set());
  const leavingTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      leavingTimersRef.current.forEach((t) => window.clearTimeout(t));
      leavingTimersRef.current = [];
    },
    []
  );
  const handleRemoveAttachment = (id: string) => {
    if (leavingAttachmentIds.has(id)) return;
    if (reducedMotion) {
      onRemoveAttachment(id);
      return;
    }
    setLeavingAttachmentIds((prev) => new Set(prev).add(id));
    const timer = window.setTimeout(() => {
      leavingTimersRef.current = leavingTimersRef.current.filter((t) => t !== timer);
      setLeavingAttachmentIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onRemoveAttachment(id);
    }, MOTION_EXIT_MS.panel);
    leavingTimersRef.current.push(timer);
  };
  // 附件架： chips 全走光且退出播完才卸载（避免截断 chip collapse）；
  // 高度走 ExitCollapse 纵向折叠（toolbar 平滑上收，否则最后 60px 硬跳）。
  // presence 时长与折叠 CSS 同源（panel 160ms），避免卸载截断动画尾。
  const shelfPresence = usePresence(attachments.length > 0, MOTION_EXIT_MS.panel);
  const [commitPulse, setCommitPulse] = useState(false);
  const commitTimerRef = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(commitTimerRef.current);
    },
    []
  );
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
  // @ mention 选项源（与 KiroContextListView 同一 Store 切片；实体变更低频，重渲染可接受）
  const mentionCourses = useAppStore((s) => s.courses);
  const mentionAssignments = useAppStore((s) => s.assignments);
  const mentionGroupProjects = useAppStore((s) => s.groupProjects);
  const setWebSearchEnabled = useKiroPreferencesStore((s) => s.setWebSearchEnabled);
  // Task B V1.1：截图隐私提示改为显式 dismiss（不再自动标记；用户没点「知道了」就下次继续提示）
  const visualPrivacyNoticeSeen = useKiroPreferencesStore((s) => s.visualAttachmentPrivacyNoticeSeen);
  const setVisualPrivacyNoticeSeen = useKiroPreferencesStore((s) => s.setVisualAttachmentPrivacyNoticeSeen);
  const canSend =
    text.trim().length > 0 &&
    // 未配置 AI 服务时禁用发送（此前可点，点后静默失败无反馈；下方已有「配置 AI 服务」入口）
    configured &&
    !hasProcessing &&
    !imagesBlocked &&
    !scannedBlocked &&
    // S-fix：选中模型已下线/不在 Catalog → 发送前即禁用（此前可发送，白等一轮才报 MODEL_NOT_FOUND；
    // ModelControl 已有 warning，此处拦住 submit + 置灰 Send，避免无效 Turn）
    !modelUnavailable &&
    !turnInFlight &&
    !preparingSend &&
    !submitting &&
    !preparingVision;
  // Task 07: Slash Skill — 仅显示 enabled skills；仅「输入中的命令」展开（选中后带空格 → 自动折叠）
  useEffect(() => {
    const query = parseSlashQuery(text);
    if (query === null) {
      slashRequestRef.current += 1; // 作废在途请求（晚回不得重开菜单）
      setSlashOpen(false);
      return;
    }
    const bridge = (window as unknown as { classflowDesktop?: { skills?: { list: () => Promise<{ skills: { name: string; description: string; enabled: boolean; kind?: string }[] }> } } }).classflowDesktop?.skills;
    if (!bridge) {
      slashRequestRef.current += 1;
      setSlashOpen(false);
      return;
    }
    const requestId = (slashRequestRef.current += 1);
    bridge
      .list()
      .then((res) => {
        // 旧请求晚回直接丢弃（当前输入已变化），否则 /a 的结果会覆盖 /ab 的菜单
        if (slashRequestRef.current !== requestId) return;
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
  // 提示条对称进退（intent 建议 / 隐私提示常被逐字输入触发开关，必须有 exit）。
  const intentRowOpen =
    hasReadyImages && visionEnabled && !hasProcessing && !currentTurnScopeLocked && text.trim().length === 0;
  // 在流内占位：退场走 ExitCollapse 高度折叠（panel 对齐），否则 30px 整块消失顶 prompt。
  const intentPresence = usePresence(intentRowOpen, MOTION_EXIT_MS.panel);
  const visionWarningOpen = (hasImages && !visionEnabled) || scannedBlocked;
  const warningPresence = usePresence(visionWarningOpen, MOTION_EXIT_MS.fast);
  const preparingPresence = usePresence(!!preparingVision, MOTION_EXIT_MS.fast);
  // intent 行 / 隐私提示已在 ExitCollapse 内（自带 exiting inert），无需重复守卫
  const warningInertRef = useInertOnHidden<HTMLSpanElement>(!warningPresence.visible);
  const privacyOpen = hasImages && !visualPrivacyNoticeSeen;
  const privacyPresence = usePresence(privacyOpen, MOTION_EXIT_MS.panel);

  // Turn scope 锁定期间：scope 类条目在 Add Menu 内部禁用（不整单锁定——联网搜索是下一 Turn preference）；
  // slash 菜单属于当前输入，同样关闭。Access / Model 菜单是 preference 或状态摘要，保持可用。
  useEffect(() => {
    if (!currentTurnScopeLocked) return;
    setSlashOpen(false);
  }, [currentTurnScopeLocked]);

  const handleMentionSelect = (option: MentionOption) => {
    // 尾随空格 = mention 已完成：菜单折叠且不会因 text 变化重新弹出（与 slash 同构）；
    // 同时写入 Manual Context chip（与 Add Menu 上下文入口同一 onAddContext）。
    setText(applyMentionPick(text, option.label));
    onAddContext(option.ref);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autoGrow();
    });
  };

  // @ mention：输入尾部 @query 即展开（与 KiroContextListView 同源；slash 打开时让路）；
  // Turn scope 锁定时关闭（@ 会改变当前工作范围）。
  useEffect(() => {
    if (currentTurnScopeLocked || slashOpen) {
      setMentionOpen(false);
      return;
    }
    const query = parseMentionQuery(text);
    if (query === null) {
      setMentionOpen(false);
      return;
    }
    const options = buildMentionOptions(mentionCourses, mentionAssignments, mentionGroupProjects, query);
    setMentionOptions(options);
    setMentionActive(0);
    setMentionOpen(options.length > 0);
  }, [text, slashOpen, mentionCourses, mentionAssignments, mentionGroupProjects, currentTurnScopeLocked]);

  // 输入高亮镜像：与 textarea 同步滚动（backdrop 方案：textarea 文字正常绘制，
  // 镜像只提供 token 背景 pill；背景透过透明 textarea 背景可见，选择/IME/光标不受影响）。
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const syncMirrorScroll = () => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) mirror.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
    syncMirrorScroll();
  };

  // Token 分段（concat 恒等于原文）；mention 展开时尾部 token 视为 active（与菜单同状态）。
  const promptTokens = React.useMemo(() => tokenizeComposerPrompt(text), [text]);
  const mentionActiveTailIndex = React.useMemo(() => {
    if (!mentionOpen) return -1;
    for (let i = promptTokens.length - 1; i >= 0; i--) {
      if (promptTokens[i].kind === "mention") return i;
    }
    return -1;
  }, [mentionOpen, promptTokens]);

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
      // P3 发送时刻：surface 轻 press（snap 档）衔接内容清空，发送有“落点”而不只是消失。
      setCommitPulse(true);
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(() => setCommitPulse(false), MOTION_MS.snap);
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
    // IME 组词中（中文拼音未上屏）的 Enter 是确认候选，必须放行给输入法：
    // 否则会把未上屏的拼音直接发送（菜单导航/发送一律不抢）。
    if (e.nativeEvent.isComposing) return;
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
    // @ mention 菜单键盘导航（与 slash 同键位；slash 打开时上面的分支已优先 return）
    if (mentionOpen && mentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActive((i) => moveMentionIndex(i, 1, mentionOptions.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActive((i) => moveMentionIndex(i, -1, mentionOptions.length));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = mentionOptions[mentionActive] ?? mentionOptions[0];
        if (target) handleMentionSelect(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  // Esc / 点击外部关闭菜单（P3：单一 openMenu ownership）。
  // Esc 用 capture 阶段：任一菜单打开即关闭全部并阻止继续传播（内层菜单未进 overlay 栈，
  // 不 stop 的话 Sidecar 的 topmost 判真会跟着关闭，造成双关）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const st = menuStateRef.current;
      if (!st.openMenu && !st.slashOpen && !st.mentionOpen) return;
      e.stopPropagation();
      setOpenMenu(null);
      setSlashOpen(false);
      setMentionOpen(false);
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
      // 内联 / 与 @ 菜单随文本驱动，Composer 内点击保留；点到 Composer 外才 dismissal
      if (!dropRef.current?.contains(t)) {
        setSlashOpen(false);
        setMentionOpen(false);
      }
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
      {/* 拖拽提示：覆盖 Composer Surface（不覆盖整个 Workspace），对称淡入淡出；
          无 backdrop-blur（透明度动画期间逐帧重模糊是已知卡顿源；遮罩盖的是自身 surface，无需模糊） */}
      {dragPresence.mounted && (
        <div
          className={cn(
            "absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-line-strong bg-surface/95 flex items-center justify-center pointer-events-none transition-[opacity,transform]",
            dragPresence.visible
              ? "opacity-100 scale-100 duration-[var(--motion-fast)]"
              : "opacity-0 scale-[0.98] duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
          )}
        >
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
          data-testid="kiro-composer-surface"
          className={cn(
            "bg-surface border border-line-strong rounded-2xl shadow-subtle",
            "focus-within:border-sandrift",
            "transition-[border-color,transform] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
            // P3 发送时刻轻 press（只响应提交瞬间，不随输入改变形状）
            commitPulse && "scale-[0.995]",
            introActive && "kiro-composer-intro"
          )}
        >
          {/* Attachment Shelf：入场 structure-settle；退场走 ExitCollapse 纵向折叠
              （fade + 高度，toolbar 平滑上收；presence 卸载与折叠同源 panel，不截断） */}
          {shelfPresence.mounted && (
            <ExitCollapse exiting={!shelfPresence.visible}>
              <div
                className={cn(
                  "bg-alabaster/40 border-b border-line-soft rounded-t-2xl",
                  compact ? "px-2.5 py-1.5" : "px-3 py-2",
                  shelfPresence.visible && "kiro-structure-settle"
                )}
              >
              {/* Tray：单行横向滚动，附件再多也不撑高 Composer；
                  chip 退出期间切 overflow-x-clip（auto 下收缩内容会触发滚动条闪烁 + 滚动量重算，
                  是 collapse 卡顿的主因；播完恢复 auto） */}
              <div
                className={cn(
                  "flex items-center gap-1.5 kiro-attachment-tray",
                  leavingAttachmentIds.size > 0 ? "overflow-x-clip" : "overflow-x-auto"
                )}
                data-testid="kiro-attachments"
              >
                {attachments.map((a) => (
                  <ExitCollapse
                    key={a.id}
                    axis="horizontal"
                    exiting={leavingAttachmentIds.has(a.id)}
                  >
                    <KiroAttachmentChip
                      attachment={a}
                      onRemove={handleRemoveAttachment}
                      onRetry={onRetryAttachment}
                      onSaveToCourse={onSaveAttachmentToCourse}
                      disabled={currentTurnScopeLocked}
                    />
                  </ExitCollapse>
                ))}
                {warningPresence.mounted && (
                  <span
                    ref={warningInertRef}
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[11px] font-semibold text-warning px-1.5 whitespace-nowrap transition-[opacity,transform]",
                      warningPresence.visible
                        ? "opacity-100 duration-[var(--motion-fast)]"
                        : "opacity-0 translate-y-[2px] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
                    )}
                  >
                    {scannedBlocked ? "扫描型 PDF 需要支持图片理解的模型" : "当前模型不支持图片理解"}
                    <button
                      onClick={() => setOpenMenu("model")}
                      className="underline underline-offset-2 decoration-line-strong hover:text-charcoal"
                    >
                      切换模型
                    </button>
                  </span>
                )}
                {preparingPresence.mounted && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[11px] font-semibold text-sandrift px-1.5 whitespace-nowrap transition-[opacity,transform]",
                      preparingPresence.visible
                        ? "opacity-100 duration-[var(--motion-fast)]"
                        : "opacity-0 translate-y-[2px] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
                    )}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    正在准备扫描 PDF…
                  </span>
                )}
              </div>
              {/* Task B V1.1：截图就绪（ready + vision + 无 processing）+ 输入为空时显示 intent chips。
                  点击只填 prompt（不直接 Send；发送必须走 canonical submit() 的 canSend/vision gate/防重复）；
                  随输入逐字开关，对称淡入淡出 */}
              {intentPresence.mounted && (
                <ExitCollapse exiting={!intentPresence.visible}>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 pt-1.5 transition-[opacity,transform]",
                      intentPresence.visible
                        ? "opacity-100 duration-[var(--motion-fast)]"
                        : "opacity-0 translate-y-[2px] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
                    )}
                  >
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
                </ExitCollapse>
              )}
              </div>
            </ExitCollapse>
          )}

          {/* Slash Skill Menu：仅「输入中的命令」展开；无演示文案；选中项高亮 + 键盘导航；对称进退 */}
          {slashPresence.mounted && (
            <div
              ref={slashInertRef}
              data-testid="skill-slash-menu"
              className={cn(
                "mx-2.5 mt-2.5 mb-0.5 bg-surface border border-line rounded-xl shadow-subtle overflow-hidden origin-bottom-left",
                compact && "mx-2",
                slashPresence.visible
                  ? "kiro-slash-enter"
                  : "opacity-0 translate-y-[6px] scale-[0.98] pointer-events-none transition-[opacity,transform] duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
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

          {/* @ mention 菜单：输入尾部 @query 即展开（专用 kiro-mention-enter；
              与 / 的 kiro-slash-enter 区分：@ 走底部中央柔附着 + 选项 stagger，
              / 走左下角指令弹出；选中回填 @label + 写入 Manual Context chip） */}
          {mentionPresence.mounted && (
            <div
              ref={mentionInertRef}
              data-testid="kiro-mention-menu"
              className={cn(
                "mx-2.5 mt-2.5 mb-0.5 bg-surface border border-line rounded-xl shadow-subtle overflow-hidden origin-bottom",
                compact && "mx-2",
                mentionPresence.visible
                  ? "kiro-mention-enter"
                  : "opacity-0 translate-y-[4px] scale-[0.99] pointer-events-none transition-[opacity,transform] duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
              )}
            >
              <div
                role="listbox"
                aria-label="上下文"
                className="max-h-44 overflow-y-auto overscroll-contain py-1"
              >
                {mentionOptions.map((option, index) => {
                  const active = index === mentionActive;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setMentionActive(index)}
                      onClick={() => handleMentionSelect(option)}
                      data-testid={`kiro-mention-item-${option.key}`}
                      style={{ "--kiro-mention-index": Math.min(index, 5) } as React.CSSProperties}
                      className={cn(
                        "kiro-mention-item-enter w-full text-left px-3 py-2 flex items-center gap-2 transition-colors duration-[var(--motion-fast)]",
                        active ? "bg-alabaster" : "hover:bg-alabaster/60"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-charcoal">
                        @{option.label}
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold text-sandrift">
                        {option.group}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prompt + Toolbar：统一内部 gutter，prompt 区保持最干净 */}
          <div className={cn(compact ? "px-2.5 pt-2 pb-2" : "px-3 pt-2.5 pb-2.5")}>
            {/* 输入区堆叠：backdrop 镜像（token 背景） + textarea（文字/光标/选择）。
                两层字体/行高/宽度严格一致；镜像 pointer-events-none + aria-hidden，
                只画背景（文字 transparent），布局零位移（无 padding/border 增量）。 */}
            <div className="relative">
              <div
                ref={mirrorRef}
                aria-hidden="true"
                data-testid="kiro-composer-highlight"
                className={cn(
                  "kiro-prompt-mirror pointer-events-none absolute inset-0 overflow-hidden text-sm leading-relaxed",
                  computerEnabled && (compact ? "min-h-[44px]" : "min-h-[64px]")
                )}
              >
                {promptTokens.map((token, i) =>
                  token.kind === "plain" ? (
                    <React.Fragment key={i}>{token.text}</React.Fragment>
                  ) : (
                    <span
                      key={i}
                      data-token={token.kind}
                      data-active={
                        (token.kind === "slash" && slashOpen) || i === mentionActiveTailIndex || undefined
                      }
                      className={cn(
                        "kiro-prompt-token",
                        token.kind === "slash"
                          ? "kiro-prompt-token-slash"
                          : "kiro-prompt-token-mention",
                        (token.kind === "slash" && slashOpen) || i === mentionActiveTailIndex
                          ? "kiro-prompt-token-active"
                          : undefined
                      )}
                    >
                      {token.text}
                    </span>
                  )
                )}
                {/* 尾换行占位（pre-wrap 下末尾 \n 会塌陷，补零宽字符保住镜像高度） */}
                <span>{"\u200b"}</span>
              </div>
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  autoGrow();
                }}
                onScroll={syncMirrorScroll}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                placeholder="Ask Kiro…"
                aria-label="Ask Kiro"
                className={cn(
                  "relative w-full resize-none bg-transparent text-sm text-charcoal placeholder-sandrift focus:outline-none leading-relaxed",
                  // P2：autoGrow 高度 px 跳变走 control 档过渡（输入增高不再硬跳；reduced-motion 全局兜底）
                  "transition-[height] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
                  // Computer Agent ON：输入区稳定最低高度（desktop 64 / compact 44），不随 context strip 压缩
                  computerEnabled && (compact ? "min-h-[44px]" : "min-h-[64px]")
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1.5">
              {/* 左组：＋（内容与来源）· 访问（Computer 范围 / Agent Mode） */}
              <div className="flex items-center gap-1 min-w-0">
                <div ref={addRef} className="relative min-w-0">
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
                  {/* 常挂载受控 presence（与 Access/Model 等一致）：外层硬条件会截断退出动画 */}
                  <PopoverPanel open={openMenu === "add"} placement="top-start" motionProfile="kiro" className="w-60">
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
                </div>

                <div ref={accessRef} className="relative min-w-0">
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
              <div className="flex items-center gap-1 min-w-0">
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
                <div ref={modelRef} className="relative min-w-0">
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
        ) : (
          // 包裹常驻（空时零高度）：此前按 attachments.length 条件挂载，删最后一颗 chip 时
          // mt-1.5（6px）整块卸载，composer 被顶下去一跳；现只有 <p> 走 presence，容器不动。
          <div className={cn("space-y-1", compact ? "px-0" : "px-0.5")}>
            {/* Task B V1.1：首次添加图片轻提示，显式「知道了」后才不再显示（非 Dialog）；对称淡入淡出 */}
            {privacyPresence.mounted && (
              <ExitCollapse exiting={!privacyPresence.visible}>
                <p
                  data-testid="visual-privacy-notice"
                  className={cn(
                    "mt-1.5 flex items-center gap-2 text-[10px] text-sandrift transition-[opacity,transform]",
                    privacyPresence.visible
                      ? "opacity-100 duration-[var(--motion-fast)]"
                      : "opacity-0 translate-y-[2px] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
                  )}
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
              </ExitCollapse>
            )}
          </div>
        )}
      </div>
    </div>
  );
}



