"use client";

import React, { useRef, useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown, ListTree } from "lucide-react";
import { KiroAssistantTurnPresentation, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { hasMeaningfulKiroToolDetails } from "@/lib/ai/presentation/toolActivityDetails";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

type ToolBlock = Extract<KiroWorklogBlock, { kind: "tool" }>;

/** Tool Row 视觉 body（button 与普通 div 共享，避免样式漂移） */
const TOOL_ROW_BODY =
  "flex items-center gap-1.5 px-2 h-7 w-full text-left text-[11px] rounded-lg transition-colors";

/**
 * Tool Row：
 * - expandable（有真实确定性详情）→ 真实 button + aria-expanded + Chevron
 * - 否则 → 普通 div（无 aria-expanded / 无 Chevron / 不可点击）
 * 组件只消费 block.safeDetails（Task 1 已清洗），绝不读取 raw input / raw output。
 * 几何稳定：height/padding/border/background footprint 不随状态切换消失，
 * 状态主要由 icon（spinner/check/alert）与 text color 表达。
 */
function KiroToolRow({ block }: { block: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const working = block.status === "working";
  const error = block.status === "error";
  const expandable = hasMeaningfulKiroToolDetails(block.safeDetails);

  const icon = error ? (
    <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />
  ) : working ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" aria-hidden="true" />
  ) : (
    <Check className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
  );

  const rowBody = (
    <>
      {icon}
      <span className="truncate">{block.headline ?? block.label}</span>
      {expandable && (
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      )}
    </>
  );

  const rowClass = cn(TOOL_ROW_BODY, rowClasses(block));

  return (
    <div data-testid="kiro-tool-row">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={rowClass}
        >
          {rowBody}
        </button>
      ) : (
        <div className={rowClass}>{rowBody}</div>
      )}
      {expandable && (
        <DisclosureRegion open={open} innerClassName="mt-0.5 pl-2 pr-2 pb-1 space-y-0.5">
          {block.safeDetails.map((d) => (
            <p key={d} className="text-[10px] text-satin-grey leading-relaxed">
              {d}
            </p>
          ))}
        </DisclosureRegion>
      )}
    </div>
  );
}

/** 几何稳定——所有状态保留同一 border/背景 footprint（透明/半透明差异），字体 weight 不跳变 */
function rowClasses(block: ToolBlock): string {
  if (block.status === "error") return "text-danger border border-danger-border/60 bg-danger-bg/40";
  if (block.status === "working") return "text-charcoal border border-line-soft bg-alabaster/50";
  // completed：保留 border footprint（透明）避免 working → done 时边框结构消失；文字降权
  return "text-satin-grey border border-transparent hover:bg-alabaster";
}

/**
 * Kiro Worklog（Density Polish + Streaming UX V3 + V4 + V4.1 Stable）：
 * - 整体 disclosure：Summary（ListTree + 步骤统计）→ 点击折叠/展开
 * - V4.1：当前 Turn 生命周期（working → composing → answering → done）保持当前 expanded 状态，
 *   完成瞬间不强制折叠（无大高度跳动）；历史恢复（初始 done）默认折叠；用户手动操作始终优先
 * - Body 只包含真实 Agent trace：commentary + tool rows（无 milestone / 无 loading pseudo-row /
 *   无入场动画——真实事件到达即出现）
 * - Final Answer 分割线无论折叠与否都保留
 */
export function KiroWorklog({ turn }: { turn: KiroAssistantTurnPresentation }) {
  const toolBlocks = turn.worklog.filter(
    (block): block is Extract<KiroWorklogBlock, { kind: "tool" }> => block.kind === "tool"
  );
  const toolCount = toolBlocks.length;
  const completedToolCount = toolBlocks.filter(
    (block) => block.status === "done" || block.status === "error"
  ).length;

  // 当前 Turn：working/composing/answering 保持 expanded；历史恢复（初始 done）默认折叠；
  // 不因 done 瞬时 collapse（避免完成瞬间 layout 跳动）；用户手动操作始终优先。
  const [expanded, setExpanded] = useState(
    turn.phase === "working" || turn.phase === "composing" || turn.phase === "answering"
  );
  const userToggledRef = useRef(false);

  const toggleExpanded = () => {
    userToggledRef.current = true;
    setExpanded((value) => !value);
  };

  // V4：稳定的 Summary——详细进度由 Timeline 展示，Summary 不做高速实时计数
  const summaryLabel =
    turn.phase === "composing"
      ? "正在整理回答"
      : turn.phase === "working"
        ? "正在执行"
        : `已完成 · ${toolCount} 个步骤`;

  return (
    <div data-testid="kiro-worklog" className="space-y-1 min-w-0 w-full">
      {/* Group Summary：整体 disclosure（工作流图标 + 统计 + Chevron） */}
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-sandrift hover:bg-alabaster/60 transition-colors"
      >
        <ListTree className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <span className="truncate" role="status" aria-live="polite" aria-atomic="true">
          {summaryLabel}
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
            expanded && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* Expanded：commentary / Tool rows 真实时序（无 synthetic row）；collapsed 时结构收起 */}
      <DisclosureRegion open={expanded} innerClassName="pt-1 space-y-1">
        {turn.worklog.map((block) =>
          block.kind === "commentary" ? (
            <p
              key={block.id}
              className="text-[11px] text-sandrift leading-relaxed whitespace-pre-wrap break-words"
            >
              {block.text}
            </p>
          ) : (
            <KiroToolRow key={block.id} block={block} />
          )
        )}
      </DisclosureRegion>

      {/* Final Answer 前的极弱分割线：无论折叠与否都保留 */}
      {turn.worklog.length > 0 && turn.answer.length > 0 && (
        <div className="border-t border-line-soft my-1.5" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * 首 token 前占位：Kiro Logo（glow）+ 「正在准备」。
 * Assistant 任一可见 part（content / worklog / action）出现后自动消失，绝不与消息 Logo 同时出现。
 */
export function KiroPendingIndicator() {
  return (
    <div
      data-testid="kiro-pending"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-3 animate-enter"
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
        <KiroLogoIcon className="w-5 h-5 kiro-agent-logo-active kiro-agent-logo-glow" />
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-charcoal">正在准备</span>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
}
