"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Copy, Pencil, RefreshCw, MoreHorizontal, Send, Globe2 } from "lucide-react";
import { KiroAssistantShell } from "@/components/kiro/KiroAssistantShell";
import { KiroStreamingMarkdown } from "@/components/kiro/KiroStreamingMarkdown";
import { KiroAgentRun, KiroAgentRunApprovalBinding } from "@/components/kiro/run/KiroAgentRun";
import { KiroAgentRunResult } from "@/components/kiro/run/KiroAgentRunResult";
import { KiroExecutionPlanCard } from "@/components/kiro/run/KiroExecutionPlanCard";
import { KiroAgentTask } from "@/lib/ai/computer/task";
import { PersistedComputerTaskView } from "@/lib/ai/history/types";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider, useKiroPopover } from "@/components/kiro/KiroMenu";
import { KiroSourcesMenuView } from "@/components/kiro/KiroSourcesMenuView";
import { useToastStore } from "@/store/useToastStore";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { resolveLiveImageSource } from "@/lib/ai/attachments/liveImageRegistry";
import { KiroImagePreviewDialog } from "@/components/kiro/KiroImagePreviewDialog";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { collectCitedWebSources, citationScanBucket } from "@/lib/ai/citations/parser";
import { UserMessageEditBlockReason } from "@/lib/ai/history/messageEditing";
import { KiroAssistantTurnPresentation } from "@/lib/ai/presentation/turnPresentation";
import { citationsToReadableText } from "@/lib/ai/citations/parser";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  markdownToPlainText,
  copyTextToClipboard,
} from "@/lib/ai/share";

/**
 * Kiro 回复 Message：Kiro mark + 文档流（非左右气泡）。
 * 内容经 KiroMarkdown 渲染（真实 Markdown，不显示原始符号）。
 * Message 级操作：Copy / 重新生成（仅最后一条 assistant）/ More（复制文本 / Markdown / 结果摘要）。
 * 流式光标在 Markdown 渲染器外部显示，不拼进 Markdown source。
 * 移动端：操作常驻（不依赖 hover）；桌面 hover/focus 显示。
 */
export function KiroMessage({
  content,
  streaming,
  children,
  testid,
  messageId,
  canRegenerate,
  actionSummaries,
  actionsReady,
  sources,
  assistantTurn,
  computerTask,
  historyComputerTask,
  historyTaskCanUndo,
  executionPlans,
  approval,
  turnInFlight,
  questionAnswerable,
  desktopPaused,
  onStop,
  onReviewComputerTask,
  onUndoComputerTask,
  onApprovePlan,
  onCancelPlan,
  showRegenerateAnswer,
  onRegenerateAnswer,
  onRetry,
}: {
  content?: string;
  /** 流式进行中：末尾显示克制状态光标 */
  streaming?: boolean;
  children?: React.ReactNode;
  testid?: string;
  /** 纯 DOM metadata（V4.7.2 benchmark：turn/message 精确绑定；无状态、无行为变化） */
  messageId?: string;
  /** 允许「重新生成」：仅 live 最新 read-only turn（含 Write Tool 或历史恢复的轮次为 false） */
  canRegenerate?: boolean;
  /** Action Result 摘要文本（复制结果摘要用，仅可见事实） */
  actionSummaries?: string[];
  /** 整个 Assistant Turn 是否已完成（chat.status 回到 ready）；最后一条消息由它决定操作栏时机 */
  actionsReady?: boolean;
  /** 本消息可用的文档来源（Citation 渲染与导出用；不含正文） */
  sources?: KiroSourceMeta[];
  /** Worklog V2：有序 Assistant Turn（commentary → tool → … → final answer） */
  assistantTurn?: KiroAssistantTurnPresentation;
  /** P4：owning Computer Task（Agent Run 状态 + Result 区事实来源） */
  computerTask?: KiroAgentTask;
  /** P4：历史恢复的 Computer Task（display-only） */
  historyComputerTask?: PersistedComputerTaskView;
  /**
   * S-fix durable undo：恢复任务附带未使用的 durable checkpoint 时，历史 Result 区可撤销。
   * 由 view.historyTaskCanUndo 驱动（memo 计算；用后经 viewCache bust 重算）。
   */
  historyTaskCanUndo?: boolean;
  /** P4：属于本 Run 的 Inline Approval（taskId 已精确匹配） */
  approval?: KiroAgentRunApprovalBinding | null;
  /** P4：本消息是否为 live run（turn 进行中且为最后一条 assistant） */
  turnInFlight?: boolean;
  /** Agent Superpowers：最后一条 assistant message 且当前无进行中 turn → Ask Card 可回答 */
  questionAnswerable?: boolean;
  /** P4：Desktop GUI Session 暂停（仅 live run 生效） */
  desktopPaused?: boolean;
  /** P4：Run Header 的停止入口（canonical Stop） */
  onStop?: () => void;
  onReviewComputerTask?: (taskId: string) => void;
  onUndoComputerTask?: (taskId: string) => void;
  /** plan-approve：本消息拥有的执行计划（proposingMessageId 精确绑定） */
  executionPlans?: PersistedExecutionPlan[];
  onApprovePlan?: (planId: string) => void;
  onCancelPlan?: (planId: string) => void;
  /** 空终答追答按钮显隐（父行已判定 settled 末条 + 空终答） */
  showRegenerateAnswer?: boolean;
  /** 空终答追答（纯文本重跑；零工具） */
  onRegenerateAnswer?: () => void;
  /** 重新生成（由 Conversation 注入稳定 callback，避免每行订阅 Session Context） */
  onRetry?: () => void;
}) {
  const pushToast = useToastStore((s) => s.pushToast);
  const more = useKiroPopover();

  // More Popover 页面状态：actions（默认）/ sources；每次打开都回到 actions
  const [moreView, setMoreView] = useState<"actions" | "sources">("actions");
  const toggleMore = () => {
    setMoreView("actions");
    more.toggle();
  };

  // Final Answer 实际引用的 Web Sources（首次引用顺序、去重）——用于 More → 来源。
  // V4.2：streaming / actions 未就绪时不算（Message Actions / More 此时不可用；
  // 每次 token 全量扫描正文是纯浪费）；Turn settled 后只计算一次并缓存。
  const citedWebSources = React.useMemo(() => {
    if (!actionsReady || streaming) return [] as KiroSourceMeta[];
    return collectCitedWebSources(content ?? "", sources);
  }, [actionsReady, streaming, content, sources]);

  // V2 二次优化：流式中即时预取引用来源（live citation prefetch），24ms 节流下额外扫描成本可控（8K 正则）
  // settled 后由 citedWebSources 接管 More 菜单，live 仅作轻量 tray 预览
  // S-fix：按内容长度分桶采样（同桶跳过重扫；超长回答扫描量从每 token 一次降为每 512 字符一次）
  const liveScanBucket = citationScanBucket(content?.length ?? 0);
  const liveCitedWebSources = React.useMemo(() => {
    if (!content || !sources || sources.length === 0) return [] as KiroSourceMeta[];
    if (!streaming) return [] as KiroSourceMeta[];
    return collectCitedWebSources(content, sources);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveScanBucket, sources, streaming]);

  const reducedMotion = useEffectiveReducedMotion();
  // streaming cursor 只在 Final Answer 真正 streaming 时出现（phase === "answering" 且
  // answer 仍有 streaming text part）；绝不给 commentary / tool row / 已完成的 answer 显示 cursor。
  // Streaming UX V5：caret 由 KiroStreamingMarkdown 渲染在真实文本末尾（不再作为 block 之后的兄弟节点）。
  const showStreamingCursor = assistantTurn
    ? assistantTurn.phase === "answering" && assistantTurn.answerStreaming
    : streaming;
  // live 引用 tray：settled 后折叠退场（直接卸载会顶起下方工具栏）；
  // presence 与 ExitCollapse 的 --motion-exit-panel（160ms）对齐，避免折叠尾段被截断。
  const liveTrayPresence = usePresence(
    streaming === true && liveCitedWebSources.length > 0,
    MOTION_EXIT_MS.panel
  );
  const showComposingSkeleton =
    assistantTurn?.phase === "composing" && !content && !assistantTurn.answerStreaming;

  const copyMarkdownSource = async () => {
    const ok = await copyTextToClipboard(citationsToReadableText(content ?? "", sources));
    if (ok) pushToast({ message: "已复制" });
  };

  const copyPlain = async () => {
    const ok = await copyTextToClipboard(markdownToPlainText(citationsToReadableText(content ?? "", sources)));
    if (ok) pushToast({ message: "已复制" });
    more.close();
  };

  const copySummary = async () => {
    const texts: string[] = [];
    if (content) texts.push(markdownToPlainText(citationsToReadableText(content, sources)));
    if (actionSummaries && actionSummaries.length > 0) texts.push(`操作结果：${actionSummaries.join("；")}`);
    const ok = await copyTextToClipboard(texts.join("\n"));
    if (ok) pushToast({ message: "已复制" });
    more.close();
  };

  const hasActions = !!actionSummaries && actionSummaries.length > 0;

  return (
    // V4.6：统一 KiroAssistantShell（Pending 共用同一 outer——Logo/左侧 column 不 remount）
    <KiroAssistantShell testid={testid ?? "kiro-message"} messageId={messageId}>
      {/* P4 Agent Run：execution lane（Header + Timeline + Inline Approval）；
          Final Answer 与 execution 是不同 lane——本组件不包裹 Final Answer */}
      {assistantTurn && (
        <KiroAgentRun
          assistantTurn={assistantTurn}
          computerTask={computerTask}
          approval={approval}
          turnInFlight={!!turnInFlight}
          desktopPaused={desktopPaused}
          questionAnswerable={questionAnswerable}
          onStop={onStop}
        />
      )}
        {(content || showComposingSkeleton) ? (
          // 骨架→首 token 同槽位淡入（key 切换触发挂载动画；流式中 content 常驻不重播）
          <div key={content ? "content" : "skeleton"} className="ux-fade">
            {/* Worklog V2 Task 4：Stable Blocks（React.memo 缓存）+ Active Tail（同语义 Markdown） */}
            {content ? (
              <KiroStreamingMarkdown
                content={content}
                streaming={!!streaming}
                sources={sources}
                showCursor={showStreamingCursor === true}
              />
            ) : (
              <div
                data-testid="kiro-composing-skeleton"
                aria-hidden="true"
                className="ux-skeleton space-y-1.5 py-1"
              >
                <div className="h-3 w-3/4 rounded bg-alabaster animate-pulse" style={{ animationDuration: reducedMotion ? "0s" : undefined }} />
                <div className="h-3 w-1/2 rounded bg-alabaster/70 animate-pulse" style={{ animationDuration: reducedMotion ? "0s" : undefined }} />
              </div>
            )}
            {/* V2 live 引用预取：流式中即显示已引用的来源 chips（settled 后收敛到 More→来源） */}
            {liveTrayPresence.mounted && (
              <ExitCollapse exiting={!liveTrayPresence.visible}>
              <div
                data-testid="kiro-live-citations"
                className="mt-2 flex flex-wrap gap-1.5"
                aria-live="polite"
              >
                {liveCitedWebSources.slice(0, 3).map((s) => (
                  <span
                    key={s.sourceId}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-alabaster border border-line text-[10px] font-medium text-satin-grey animate-enter"
                  >
                    <Globe2 className="w-3 h-3 text-sandrift shrink-0" />
                    <span className="truncate max-w-[120px]">{s.name}</span>
                  </span>
                ))}
                {liveCitedWebSources.length > 3 && (
                  <span className="inline-flex items-center px-2 py-1 text-[10px] text-sandrift">+{liveCitedWebSources.length - 3}</span>
                )}
              </div>
              </ExitCollapse>
            )}
            {/* Hotfix：正文底部不再显示独立 Sources Tray（来源移入 More → 来源） */}
            {/* Message Actions：整个 Turn 结束后常驻（不依赖 hover），低权重 inline toolbar；settle 时淡入 */}
            <ExitCollapse exiting={!((actionsReady ?? true) && !streaming)}>
              {(actionsReady ?? true) && !streaming && (
              <div className="flex items-center gap-1 text-[11px] font-semibold text-sandrift animate-enter">
                <button
                  onClick={copyMarkdownSource}
                  aria-label="复制"
                  className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  复制
                </button>
                {canRegenerate && onRetry && (
                  <button
                    onClick={onRetry}
                    aria-label="重新生成"
                    className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重新生成
                  </button>
                )}
                <div ref={more.ref} className="relative">
                  <button
                    onClick={toggleMore}
                    aria-label="消息更多操作"
                    aria-expanded={more.open}
                    className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <KiroMenuPanel
                    open={more.open}
                    placement="top-end"
                    className={moreView === "sources" ? "w-[280px]" : undefined}
                  >
                    {/* 面板内 drill 切换（actions ↔ sources）：keyed view + ux-kiro-view-enter，
                        进入带方向（来源 +4px / 返回 -4px），与 Navigator/AddMenu 同语法 */}
                    <div
                      key={moreView}
                      className="ux-kiro-view-enter"
                      style={{ ["--motion-shift-x" as string]: moreView === "sources" ? "4px" : "-4px" } as React.CSSProperties}
                    >
                      {moreView === "sources" ? (
                        <KiroSourcesMenuView
                          sources={citedWebSources}
                          onBack={() => setMoreView("actions")}
                        />
                      ) : (
                        <>
                          <KiroMenuItem icon={Copy} label="复制文本" onClick={copyPlain} />
                          <KiroMenuItem icon={FileText} label="复制 Markdown" onClick={copyMarkdownSource} />
                          {hasActions && (
                            <>
                              <KiroMenuDivider />
                              <KiroMenuItem icon={FileText} label="复制结果摘要" onClick={copySummary} />
                            </>
                          )}
                          {citedWebSources.length > 0 && (
                            <>
                              <KiroMenuDivider />
                              <KiroMenuItem
                                icon={Globe2}
                                label={`来源 · ${citedWebSources.length}`}
                                onClick={() => setMoreView("sources")}
                              />
                            </>
                          )}
                        </>
                      )}
                    </div>
                    </KiroMenuPanel>
                </div>
              </div>
              )}
            </ExitCollapse>
          </div>
        ) : null}
      {/* P4 Agent Run Result：Final Answer 之后的低权重结果区（只终态；运行中绝不重复 Task 步骤） */}
      {(computerTask || historyComputerTask) && (
        <KiroAgentRunResult
          task={computerTask}
          historyTask={historyComputerTask}
          historyTaskCanUndo={historyTaskCanUndo}
          onReview={onReviewComputerTask}
          onUndo={onUndoComputerTask}
        />
      )}
      {/* plan-approve：执行计划卡片（Result 区之后；live/恢复统一） */}
      {executionPlans?.map((plan) => (
        <KiroExecutionPlanCard
          key={plan.planId}
          plan={plan}
          onApprove={onApprovePlan}
          onCancel={onCancelPlan}
        />
      ))}
      {/* 空终答安全网：已结算业务工具 + 零正文 → 纯文本追答（零工具重跑）；退出走折叠 */}
      <ExitCollapse exiting={!(showRegenerateAnswer && onRegenerateAnswer)}>
        {showRegenerateAnswer && onRegenerateAnswer && (
        <div className="flex items-center gap-2 pt-1 animate-enter">
          <span className="text-[10px] text-sandrift">模型未返回正文</span>
          <button
            data-testid="kiro-regenerate-answer"
            onClick={onRegenerateAnswer}
            className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba transition-colors"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            重新生成回答
          </button>
        </div>
        )}
      </ExitCollapse>
      {children}
    </KiroAssistantShell>
  );
}

/** 用户 Message：轻量 soft bubble，右对齐（纯文本 + 附件 chips，不显示提取全文）；hover 可复制 / 内联编辑 */
export function KiroUserMessage({
  messageId,
  content,
  attachments,
  canEdit,
  editDisabledReason,
  onEdit,
}: {
  messageId: string;
  content: string;
  attachments?: KiroAttachmentView[];
  /** Task 7：是否可编辑（attachment/history 最终绑定后计算） */
  canEdit?: boolean;
  editDisabledReason?: UserMessageEditBlockReason;
  onEdit?: (messageId: string, text: string) => Promise<boolean>;
}) {
  const pushToast = useToastStore((s) => s.pushToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // V1.5.1：预览携带真实文件名（Dialog 标题用 attachment.name，不再统一显示「原图」）
  const [previewSource, setPreviewSource] = useState<{ file: File; name: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const copy = async () => {
    const ok = await copyTextToClipboard(content);
    if (ok) pushToast({ message: "已复制" });
  };

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSubmitting(false);
  };

  // 轻量 autosize（不引入新依赖）
  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [editing, draft]);

  const submit = async () => {
    const v = draft.trim();
    if (!v || submitting) return; // 空内容禁止保存
    if (v === content.trim()) {
      cancelEdit(); // 内容未变：退出编辑态，不调用模型
      return;
    }
    setSubmitting(true);
    const ok = await onEdit?.(messageId, v);
    if (ok) {
      setEditing(false);
      setSubmitting(false);
    } else {
      setSubmitting(false); // 失败：保留编辑态方便修正
    }
  };

  const editDisabledTitle = editDisabledReason
    ? {
        "write-suffix": "之后已有执行操作，无法直接编辑。",
        attachments: "含附件的消息不能编辑，请重新发送。",
        "turn-in-flight": "正在处理，稍后可编辑。",
        "message-not-found": "该消息已不可编辑。",
      }[editDisabledReason]
    : undefined;

  return (
    <div className="flex justify-end group" data-testid="kiro-user-message">
      <div className="max-w-[85%] flex flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => {
              const Icon = a.kind === "image" ? ImageIcon : FileText;
              // V1.5：live 本地图片 → 点击查看原图（runtime File）；历史恢复（tempNotRetained）→ 不可预览
              const liveSource = a.kind === "image" && a.source === "local" ? resolveLiveImageSource(a.id) : undefined;
              const previewable = liveSource != null;
              return (
                <span
                  key={a.id}
                  data-testid="kiro-sent-attachment"
                  className="inline-flex items-center gap-1.5 pl-2 pr-2 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-satin-grey"
                >
                  {/* Task B：发送后的图片 chip 显示真实缩略图（不再只有图标） */}
                  {a.kind === "image" && a.thumbnail ? (
                    previewable ? (
                      <button
                        type="button"
                        data-testid="kiro-sent-image-preview"
                        onClick={() => setPreviewSource({ file: liveSource!.file, name: a.name })}
                        aria-label={`查看原图 ${a.name}`}
                        className="w-5 h-5 rounded overflow-hidden border border-line-soft shrink-0 focus:outline-none focus:ring-2 focus:ring-charcoal/20"
                      >
                        <img src={a.thumbnail} alt="" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <img
                        src={a.thumbnail}
                        alt=""
                        className="w-5 h-5 rounded object-cover shrink-0"
                      />
                    )
                  ) : (
                    <Icon className="w-3 h-3 text-sandrift shrink-0" />
                  )}
                  <span className={cn("truncate max-w-[140px]")}>{a.name}</span>
                  {a.tempNotRetained && (
                    <span
                      className="text-[9px] font-bold text-sandrift bg-alabaster border border-line-soft rounded px-1 py-px shrink-0"
                    >
                      临时附件未保留
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {editing ? (
          <div key="edit" className="w-full min-w-[260px] space-y-1.5 ux-fade">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-label="编辑消息"
              className="w-full px-3 py-2.5 bg-white border border-line-strong rounded-2xl text-xs font-medium text-charcoal focus:outline-none focus:border-charcoal resize-none whitespace-pre-wrap leading-relaxed"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                onClick={cancelEdit}
                className="px-3 h-7 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void submit()}
                disabled={!draft.trim() || submitting}
                className="ux-press flex items-center gap-1 px-3 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
              >
                <Send className="w-3 h-3" />
                {submitting ? "发送中…" : "保存并发送"}
              </button>
            </div>
            <p className="text-[9px] text-sandrift text-right">
              Esc 取消 · Ctrl/⌘+Enter 保存并发送 · Enter 换行
            </p>
          </div>
        ) : (
          <>
            <div className="bg-alabaster border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-xs font-medium text-charcoal whitespace-pre-wrap leading-relaxed ux-fade">
              {content}
            </div>
            <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                onClick={startEdit}
                disabled={!canEdit || submitting}
                aria-disabled={!canEdit}
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
              >
                <Pencil className="w-3.5 h-3.5" />
                编辑
              </button>
              <button
                onClick={copy}
                aria-label="复制"
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                复制
              </button>
            </div>
          </>
        )}
      </div>
      {/* V1.5：sent live 图片大图预览（runtime File；历史恢复无 File → 不渲染；标题用真实文件名） */}
      {previewSource && (
        <KiroImagePreviewDialog source={previewSource} onClose={() => setPreviewSource(null)} />
      )}
    </div>
  );
}
