"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown, ListTree, PartyPopper } from "lucide-react";
import { KiroAssistantTurnPresentation, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { hasMeaningfulKiroToolDetails } from "@/lib/ai/presentation/toolActivityDetails";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";

type ToolBlock = Extract<KiroWorklogBlock, { kind: "tool" }>;

/** Tool Row 视觉 body（button 与普通 div 共享，避免样式漂移） */
const TOOL_ROW_BODY =
  "flex items-center gap-1.5 px-2 h-7 w-full text-left text-[11px] rounded-lg transition-colors";

/** V4：仅首次入场的极轻动画（opacity 0→1 + translateY 1px→0；token delta 不重播） */
const ENTER_ANIMATION_CLASS = "kiro-worklog-enter";

/**
 * V4：block 首次出现播放一次入场动画（token delta / status 变化 / history restore 不重播）。
 * 只记录「已出现」的 block id；reduced motion 或 history restore（turn 已 done）不播放。
 */
function useEnterOnAdd(blockIds: string[], reducedMotion: boolean, enabled: boolean) {
  const seenRef = useRef<Set<string>>(new Set());
  const [entered, setEntered] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (reducedMotion || !enabled) return;
    const next = new Set(entered);
    let changed = false;
    for (const id of blockIds) {
      if (!seenRef.current.has(id)) {
        seenRef.current.add(id);
        next.add(id);
        changed = true;
      }
    }
    if (changed) setEntered(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockIds, reducedMotion, enabled]);
  return entered;
}

/**
 * Tool Row：
 * - expandable（有真实确定性详情）→ 真实 button + aria-expanded + Chevron
 * - 否则 → 普通 div（无 aria-expanded / 无 Chevron / 不可点击）
 * 组件只消费 block.safeDetails（Task 1 已清洗），绝不读取 raw input / raw output。
 * V4：几何稳定——height/padding/border/background footprint 不随状态切换消失，
 * 状态主要由 icon（spinner/check/alert）与 text color 表达。
 */
function KiroToolRow({ block, entered }: { block: ToolBlock; entered: boolean }) {
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

  const rowClass = cn(TOOL_ROW_BODY, rowClasses(block), entered && ENTER_ANIMATION_CLASS);

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

/** V4：几何稳定——所有状态保留同一 border/背景 footprint（透明/半透明差异），字体 weight 不跳变 */
function rowClasses(block: ToolBlock): string {
  if (block.status === "error") return "text-danger border border-danger-border/60 bg-danger-bg/40";
  if (block.status === "working") return "text-charcoal border border-line-soft bg-alabaster/50";
  // completed：保留 border footprint（透明）避免 working → done 时边框结构消失；文字降权
  return "text-satin-grey border border-transparent hover:bg-alabaster";
}

/**
 * Kiro Worklog（Density Polish + Streaming UX V3 + V4 Progressive）：
 * - 整体 disclosure：Summary（ListTree + 步骤统计）→ 点击折叠/展开
 * - 自动折叠：working/composing 展开；answering 保持（不在 Final Answer 首 token 突变）；
 *   done（真实 settled，turnExecutionState 保证）且用户未手动操作 → 自动折叠一次
 * - commentary 完整显示（无 line-clamp）；worklog 使用消息可用宽度（无 max-w）
 * - 每个 Tool Row：generic fallback 详情不显示 Chevron（无 disclosure）
 * - V4：block 首次入场动画（useEnterOnAdd）；milestone（✓ 已完成执行）UI-only
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
  const reducedMotion = useEffectiveReducedMotion();
  // history restore（turn 已 done）不播放入场动画；只有 live 推进中的新 block 播放
  const entered = useEnterOnAdd(
    turn.worklog.map((b) => b.id),
    reducedMotion,
    turn.phase !== "done"
  );

  // 自动折叠（Streaming UX V3 Phase 3）：working/composing 展开；
  // answering（Final Answer 首 token）保持当前状态，绝不在首 token 到达时做大幅 layout mutation；
  // 只有进入 done（Turn 真正 settled）且用户未手动操作时才自动折叠。
  const [expanded, setExpanded] = useState(
    turn.phase === "working" || turn.phase === "composing"
  );
  const userToggledRef = useRef(false);
  const prevPhaseRef = useRef(turn.phase);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = turn.phase;
    if (userToggledRef.current) return;
    if (prev !== "done" && turn.phase === "done") {
      setExpanded(false);
    }
  }, [turn.phase]);

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

      {/* Expanded：commentary / Tool rows / milestone 真实时序；collapsed 时结构收起 */}
      <DisclosureRegion open={expanded} innerClassName="pt-1 space-y-1">
        {turn.worklog.map((block) => {
          if (block.kind === "commentary") {
            return (
              <p
                key={block.id}
                className={cn(
                  "text-[11px] text-sandrift leading-relaxed whitespace-pre-wrap break-words",
                  entered.has(block.id) && ENTER_ANIMATION_CLASS
                )}
              >
                {block.text}
              </p>
            );
          }
          if (block.kind === "milestone") {
            return (
              <p
                key={block.id}
                data-testid="kiro-worklog-milestone"
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-semibold text-success",
                  entered.has(block.id) && ENTER_ANIMATION_CLASS
                )}
              >
                <PartyPopper className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                已完成执行
              </p>
            );
          }
          return <KiroToolRow key={block.id} block={block} entered={entered.has(block.id)} />;
        })}
        {turn.phase === "composing" && (
          <p className="flex items-center gap-1.5 text-[11px] text-sandrift" aria-hidden="true">
            <Loader2 className="w-3 h-3 animate-spin text-sandrift shrink-0" aria-hidden="true" />
            正在整理回答
          </p>
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
