"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown, ListTree } from "lucide-react";
import { KiroAssistantTurnPresentation, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { hasMeaningfulKiroToolDetails } from "@/lib/ai/presentation/toolActivityDetails";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
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
      <span className="truncate">{block.label}</span>
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

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(TOOL_ROW_BODY, rowClasses(block))}
        >
          {rowBody}
        </button>
      ) : (
        <div className={cn(TOOL_ROW_BODY, rowClasses(block))}>{rowBody}</div>
      )}
      {open && expandable && (
        <div className="mt-0.5 pl-2 pr-2 pb-1 space-y-0.5">
          {block.safeDetails.map((d) => (
            <p key={d} className="text-[10px] text-satin-grey leading-relaxed">
              {d}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function rowClasses(block: ToolBlock): string {
  if (block.status === "error") return "text-danger bg-danger-bg/50 border border-danger-border";
  if (block.status === "working") return "text-charcoal font-semibold bg-alabaster/50 border border-line-soft";
  // completed：低权重，默认无 border/背景；有详情可展开时 hover 轻微反馈
  return "text-satin-grey hover:bg-alabaster";
}

/**
 * Kiro Worklog（Density Polish）：
 * - 整体 disclosure：Summary（ListTree + 步骤统计）→ 点击折叠/展开
 * - 自动折叠：working/composing 展开；进入 answering 自动折叠一次（用户手动 toggle 后不再覆盖）
 * - commentary 完整显示（无 line-clamp）；worklog 使用消息可用宽度（无 max-w）
 * - 每个 Tool Row：generic fallback 详情不显示 Chevron（无 disclosure）
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

  // 默认：working/composing 展开；answering/done 折叠
  const [expanded, setExpanded] = useState(
    turn.phase === "working" || turn.phase === "composing"
  );
  const userToggledRef = useRef(false);
  const prevPhaseRef = useRef(turn.phase);

  // 自动折叠：进入 answering（Final Answer 首个 token）时折叠一次；
  // 用户手动 toggle 后不再自动覆盖
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = turn.phase;
    if (userToggledRef.current) return;
    if (prev !== "answering" && turn.phase === "answering") {
      setExpanded(false);
    }
  }, [turn.phase]);

  const toggleExpanded = () => {
    userToggledRef.current = true;
    setExpanded((value) => !value);
  };

  // Summary 文案：agent 仍在执行 → 「正在执行」+ 已完成数（绝不显示 5/8 这类未知总数）
  const active = turn.phase === "working" || turn.phase === "composing";
  const summaryLabel = active
    ? completedToolCount > 0
      ? `正在执行 · 已完成 ${completedToolCount} 个步骤`
      : "正在执行"
    : `已完成 ${toolCount} 个步骤`;

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
        <span className="truncate">{summaryLabel}</span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
            expanded && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* Expanded：commentary / Tool rows 真实时序；collapsed 时整体隐藏 */}
      {expanded && (
        <div className="pt-1 space-y-1">
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
          {turn.phase === "composing" && (
            <p className="flex items-center gap-1.5 text-[11px] text-sandrift">
              <Loader2 className="w-3 h-3 animate-spin text-sandrift shrink-0" aria-hidden="true" />
              正在整理结果…
            </p>
          )}
        </div>
      )}

      {/* Final Answer 前的极弱分割线：无论折叠与否都保留 */}
      {turn.worklog.length > 0 && turn.answer.length > 0 && (
        <div className="border-t border-line-soft my-1.5" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * 首 token 前占位：Kiro Logo（glow）+ 「正在处理」。
 * Assistant 任一可见 part（content / worklog / action）出现后自动消失，绝不与消息 Logo 同时出现。
 */
export function KiroPendingIndicator() {
  return (
    <div data-testid="kiro-pending" role="status" className="flex items-center gap-3">
      <span className="w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
        <KiroLogoIcon className="w-5 h-5 kiro-agent-logo-active kiro-agent-logo-glow" />
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-charcoal">正在处理</span>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
}
