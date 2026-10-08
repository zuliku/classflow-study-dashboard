"use client";

import React, { useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { KiroTurnPhase, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { bumpStreamPerf, bumpStreamPerfKeyed } from "@/lib/ai/perf/streamPerf";
import { hasMeaningfulKiroToolDetails } from "@/lib/ai/presentation/toolActivityDetails";
import { KiroAssistantShell } from "@/components/kiro/KiroAssistantShell";
import { KiroTerminalBlock } from "@/components/kiro/computer/KiroTerminalBlock";
import { useTerminalActivityStore } from "@/store/useTerminalActivityStore";
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
/** P0：working 心跳（本地 tick 隔离在叶子；block 无时间戳，用首渲染时刻起算，长任务不再像死锁） */
function WorkingElapsed() {
  const [now, setNow] = useState(() => Date.now());
  const startedRef = React.useRef(now);
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const secs = Math.max(0, Math.round((now - startedRef.current) / 1000));
  if (secs < 5) return null;
  return (
    <span className="shrink-0 text-[10px] tabular-nums text-sandrift" title={secs > 30 ? "仍在进行，可继续等待或停止本轮" : undefined}>
      {secs > 30 ? `仍在进行 · ${secs}s` : `${secs}s`}
    </span>
  );
}

const KiroToolRow = React.memo(function KiroToolRow({ block }: { block: ToolBlock }) {
  bumpStreamPerfKeyed("toolRowRenders", block.id);
  bumpStreamPerf("toolRowRendersTotal");
  const [open, setOpen] = useState(false);
  const working = block.status === "working";
  const error = block.status === "error";
  const expandable = hasMeaningfulKiroToolDetails(block.safeDetails);

  const icon = error ? (
    <AlertCircle
      key="icon-error"
      className="w-3.5 h-3.5 text-danger shrink-0 kiro-check-settle"
      aria-hidden="true"
    />
  ) : working ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" aria-hidden="true" />
  ) : (
    // BUG-G5：working → done 到达时一次性 check-settle（key 变化触发重挂载播放）
    <Check key="icon-check" className="w-3 h-3 text-success shrink-0 kiro-check-settle" aria-hidden="true" />
  );

  const rowBody = (
    <>
      {icon}
      <span className="truncate">{block.headline ?? block.label}</span>
      {working && <WorkingElapsed />}
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
    <div data-testid="kiro-tool-row" className="animate-enter">
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
 * Kiro Worklog Timeline（Streaming UX V3 + V4 + V4.1 Stable + V4.2 Hot Path + P4 抽离）：
 * - 只负责 canonical Agent trace 的 body：commentary + Tool rows + Terminal activity + Final Answer 分割线；
 * - Header / disclosure ownership / Inline Approval 由 Agent Run 层负责（KiroAgentRun）；
 * - V4.2：memo + 明确 comparator——props 缩窄为 worklog + phase + reasoningSummary + expanded。
 *   Final Answer token 期间 worklog 内容不变 → Timeline 不重渲染，completed Tool 不重渲染；
 * - Final Answer 分割线无论折叠与否都保留（answering/done 才可能有 answer）；
 * - raw reasoning 永不显示：只有压缩 reasoningSummary 占位。
 */
export const KiroWorklogTimeline = React.memo(function KiroWorklogTimeline({
  worklog,
  phase,
  reasoningSummary,
  expanded,
}: {
  worklog: KiroWorklogBlock[];
  phase: KiroTurnPhase;
  reasoningSummary?: string;
  expanded: boolean;
}) {
  bumpStreamPerf("worklogRenders");
  bumpStreamPerfKeyed("worklogRendersByPhase", phase);

  const toolBlocks = worklog.filter(
    (block): block is Extract<KiroWorklogBlock, { kind: "tool" }> => block.kind === "tool"
  );

  // Terminal V2：runtime activity（UI-only；sanitized；按 toolCallId 精确关联本 turn 的
  // run_terminal_command；历史恢复 turn 无对应 activity → 自动过滤）
  const terminalActivities = useTerminalActivityStore((s) => s.activities);
  const toolCallIds = new Set(
    toolBlocks.map((b) => b.toolCallId).filter((id): id is string => id.length > 0)
  );
  const terminalBlocks = terminalActivities.filter((a) => toolCallIds.has(a.toolCallId));

  return (
    <div data-testid="kiro-worklog" className="min-w-0 w-full">
      <DisclosureRegion open={expanded} innerClassName="space-y-1">
        {worklog.length === 0 && reasoningSummary && (
          <p
            data-testid="kiro-reasoning-summary"
            className="text-[11px] text-sandrift leading-relaxed whitespace-pre-wrap break-words"
            aria-live="polite"
          >
            {reasoningSummary}
          </p>
        )}
        {worklog.map((block) =>
          block.kind === "commentary" ? (
            <p
              key={block.id}
              className="text-[11px] text-sandrift leading-relaxed whitespace-pre-wrap break-words animate-enter"
            >
              {block.text}
            </p>
          ) : (
            <KiroToolRow key={block.id} block={block} />
          )
        )}
        {/* Terminal V2 Streaming：runtime activity 实时输出（挂在对应 tool row 之后） */}
        {terminalBlocks.map((activity) => (
          <KiroTerminalBlock key={activity.executionId} activity={activity} />
        ))}
      </DisclosureRegion>

      {/* Final Answer 前的极弱分割线：无论折叠与否都保留（answering/done 才可能有 answer） */}
      {worklog.length > 0 && (phase === "answering" || phase === "done") && (
        <div className="border-t border-line-soft my-1.5 ux-fade" aria-hidden="true" />
      )}
    </div>
  );
}, worklogTimelinePropsEqual);

/** KiroWorklogTimeline comparator：只有 expanded / phase / reasoningSummary 或 worklog 内容真正变化才重渲染 */
function worklogTimelinePropsEqual(
  a: {
    worklog: KiroWorklogBlock[];
    phase: KiroTurnPhase;
    reasoningSummary?: string;
    expanded: boolean;
  },
  b: {
    worklog: KiroWorklogBlock[];
    phase: KiroTurnPhase;
    reasoningSummary?: string;
    expanded: boolean;
  }
): boolean {
  return (
    a.expanded === b.expanded &&
    a.phase === b.phase &&
    a.reasoningSummary === b.reasoningSummary &&
    worklogEquals(a.worklog, b.worklog)
  );
}

/**
 * 首 token 前占位：Kiro Logo（glow）+ 「正在准备」。
 * Assistant 任一可见 part（content / worklog / action）出现后自动消失，绝不与消息 Logo 同时出现。
 * V4.6：与 KiroMessage 共用 KiroAssistantShell（geometry 一致），无 animate-enter（transient
 * system state 不需要 200ms slide/fade——真实事件到达即展示）。
 * 心跳：挂载起 1s tick 显示已等待秒数（长 reasoning 首 token 前数分钟零反馈 → 有计时可感知存活；
 * 仅本小组件重渲染；首 token 到达即卸载，不影响流式）。
 */
export function KiroPendingIndicator() {
  const mountedAtRef = React.useRef<number>(Date.now());
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const waitedSec = Math.max(0, Math.floor((Date.now() - mountedAtRef.current) / 1000));
  return (
    <KiroAssistantShell>
      <div
        data-testid="kiro-pending"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center gap-1.5"
      >
        <span className="text-xs font-medium text-charcoal">
          正在准备{waitedSec >= 3 ? ` · 已等待 ${waitedSec} 秒` : ""}
        </span>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
      </div>
    </KiroAssistantShell>
  );
}
