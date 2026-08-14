"use client";

import React, { useRef, useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown, ListTree } from "lucide-react";
import { KiroTurnPhase, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { bumpStreamPerf, bumpStreamPerfKeyed } from "@/lib/ai/perf/streamPerf";
import { hasMeaningfulKiroToolDetails } from "@/lib/ai/presentation/toolActivityDetails";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

type ToolBlock = Extract<KiroWorklogBlock, { kind: "tool" }>;
type CommentaryBlock = Extract<KiroWorklogBlock, { kind: "commentary" }>;

/** Tool Row 视觉 body（button 与普通 div 共享，避免样式漂移） */
const TOOL_ROW_BODY =
  "flex items-center gap-1.5 px-2 h-7 w-full text-left text-[11px] rounded-lg transition-colors";

/**
 * Tool Row（V4.2 Hot Path）：React.memo——completed tool 在 Final Answer token
 * 期间绝不重渲染。comparator 只比较影响显示的可变字段（id/status/headline/label/
 * safeDetails 逐项），local open disclosure state 不受影响（memo 只跳过 render）。
 */
const KiroToolRow = React.memo(function KiroToolRow({ block }: { block: ToolBlock }) {
  bumpStreamPerfKeyed("toolRowRenders", block.id);
  bumpStreamPerf("toolRowRendersTotal");
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
}, (prevProps: { block: ToolBlock }, nextProps: { block: ToolBlock }) =>
  toolBlockEquals(prevProps.block, nextProps.block));

/** Tool block 显示字段逐项比较（数组逐元素 ===；引用变化但内容相同 → 不重渲染） */
function toolBlockEquals(a: ToolBlock, b: ToolBlock): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.status !== b.status || a.headline !== b.headline || a.label !== b.label) return false;
  if (a.safeDetails.length !== b.safeDetails.length) return false;
  for (let i = 0; i < a.safeDetails.length; i++) {
    if (a.safeDetails[i] !== b.safeDetails[i]) return false;
  }
  return true;
}

/** commentary block 显示字段逐项比较 */
function commentaryEquals(a: CommentaryBlock, b: CommentaryBlock): boolean {
  return a === b || (a.id === b.id && a.text === b.text && a.streaming === b.streaming);
}

/** worklog 数组逐 block 比较（id + 显示字段；worklog 重排 / block 内部变化才触发渲染） */
function worklogEquals(
  a: KiroWorklogBlock[],
  b: KiroWorklogBlock[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.id !== y.id) return false;
    if (x.kind === "commentary" && y.kind === "commentary") {
      if (!commentaryEquals(x, y)) return false;
    } else if (x.kind === "tool" && y.kind === "tool" && !toolBlockEquals(x, y)) {
      return false;
    }
  }
  return true;
}

/** 几何稳定——所有状态保留同一 border/背景 footprint（透明/半透明差异），字体 weight 不跳变 */
function rowClasses(block: ToolBlock): string {
  if (block.status === "error") return "text-danger border border-danger-border/60 bg-danger-bg/40";
  if (block.status === "working") return "text-charcoal border border-line-soft bg-alabaster/50";
  // completed：保留 border footprint（透明）避免 working → done 时边框结构消失；文字降权
  return "text-satin-grey border border-transparent hover:bg-alabaster";
}

/**
 * Kiro Worklog（Density Polish + Streaming UX V3 + V4 + V4.1 Stable + V4.2 Hot Path）：
 * - 整体 disclosure：Summary（ListTree + 步骤统计）→ 点击折叠/展开
 * - V4.1：当前 Turn 生命周期（working → composing → answering → done）保持当前 expanded 状态，
 *   完成瞬间不强制折叠（无大高度跳动）；历史恢复（初始 done）默认折叠；用户手动操作始终优先
 * - Body 只包含真实 Agent trace：commentary + tool rows（无 milestone / 无 loading pseudo-row /
 *   无入场动画——真实事件到达即出现）
 * - V4.2：memo + 明确 comparator——props 缩窄为 worklog + phase（不需要 answer / hasTools 等）。
 *   phase 只影响 Summary 文案与分割线（低频 transition）；worklog 数组逐 block 比较——
 *   Final Answer token 期间 worklog 内容不变 → 整个 Worklog 不重渲染，completed Tool 不重渲染。
 * - Final Answer 分割线无论折叠与否都保留
 */
export const KiroWorklog = React.memo(function KiroWorklog({
  worklog,
  phase,
}: {
  worklog: KiroWorklogBlock[];
  phase: KiroTurnPhase;
}) {
  bumpStreamPerf("worklogRenders");
  bumpStreamPerfKeyed("worklogRendersByPhase", phase);
  const toolBlocks = worklog.filter(
    (block): block is Extract<KiroWorklogBlock, { kind: "tool" }> => block.kind === "tool"
  );
  const toolCount = toolBlocks.length;
  const completedToolCount = toolBlocks.filter(
    (block) => block.status === "done" || block.status === "error"
  ).length;

  // 当前 Turn：working/composing/answering 保持 expanded；历史恢复（初始 done）默认折叠；
  // 不因 done 瞬时 collapse（避免完成瞬间 layout 跳动）；用户手动操作始终优先。
  const [expanded, setExpanded] = useState(
    phase === "working" || phase === "composing" || phase === "answering"
  );
  const userToggledRef = useRef(false);

  const toggleExpanded = () => {
    userToggledRef.current = true;
    setExpanded((value) => !value);
  };

  // V4：稳定的 Summary——详细进度由 Timeline 展示，Summary 不做高速实时计数
  const summaryLabel =
    phase === "composing"
      ? "正在整理回答"
      : phase === "working"
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
        {worklog.map((block) =>
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

      {/* Final Answer 前的极弱分割线：无论折叠与否都保留（answering/done 才可能有 answer） */}
      {worklog.length > 0 && (phase === "answering" || phase === "done") && (
        <div className="border-t border-line-soft my-1.5" aria-hidden="true" />
      )}
    </div>
  );
}, worklogPropsEqual);

/** KiroWorklog comparator：只有 phase 或 worklog 内容真正变化才重渲染 */
function worklogPropsEqual(
  a: { worklog: KiroWorklogBlock[]; phase: KiroTurnPhase },
  b: { worklog: KiroWorklogBlock[]; phase: KiroTurnPhase }
): boolean {
  return a.phase === b.phase && worklogEquals(a.worklog, b.worklog);
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
