"use client";

import React, { useMemo } from "react";
import { Gauge } from "lucide-react";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import {
  INSPECTOR_CONTEXT_USAGE_LIMIT,
  buildInspectorContextUsageHistory,
} from "@/lib/ai/ui/kiroInspector";
import { getModelContextWindowTokens } from "@/lib/ai/providers/registry";
import {
  formatContextUsageLabel,
  formatContextUsageTokens,
  resolveModelWindowUsage,
} from "@/lib/ai/contextBudget/usage";
import {
  KiroInspectorEmptyState,
  KiroInspectorRow,
  KiroInspectorSection,
} from "@/components/kiro/inspector/KiroInspectorSection";
import { cn } from "@/lib/utils";

const TONE_BAR: Record<string, string> = {
  ok: "bg-charcoal",
  warn: "bg-warning",
  danger: "bg-danger",
  unknown: "bg-line-strong",
};

/**
 * Kiro Inspector — 上下文占用（Phase 2，Codex-style 层级）。
 *
 * 数据：会话内每次请求的估算快照（ref 读取 + contextUsageVersion 低频信号；
 * 不订阅 token / messages）；新 → 旧，最多 8 条。
 * 只读展示：不重新计算预算 / 不触发请求；模型窗口 % 仅当 registry 有官方可核实值时显示。
 */
export function KiroInspectorContextUsage() {
  const meta = useKiroSessionMeta();

  const snapshots = useMemo(
    () => meta.getConversationContextUsage(),
    // contextUsageVersion：新快照 / 会话切换时刷新（低频 scalar）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.contextUsageVersion, meta.currentConversationId, meta]
  );

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const rows = useMemo(
    () => buildInspectorContextUsageHistory(snapshots, { limit: INSPECTOR_CONTEXT_USAGE_LIMIT }),
    [snapshots]
  );
  const windowUsage = useMemo(
    () =>
      resolveModelWindowUsage(
        latest,
        latest ? getModelContextWindowTokens({ provider: latest.provider, model: latest.model }) : undefined
      ),
    [latest]
  );

  return (
    <KiroInspectorSection title="上下文" count={rows.length} testId="kiro-inspector-context-usage">
      {rows.length === 0 || !latest ? (
        <KiroInspectorEmptyState
          icon={<Gauge className="w-3.5 h-3.5" />}
          text="暂无占用记录"
          hint="发送第一条消息后显示"
        />
      ) : (
        <>
          {/* 最近一次：对话预算占用 + 模型窗口 %（有官方窗口时） */}
          <div className="px-2 py-1.5 space-y-1" data-testid="kiro-inspector-context-latest">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-charcoal truncate">
                {formatContextUsageLabel(latest)}
              </span>
              <span className="text-[10px] text-sandrift truncate max-w-[120px]" title={latest.model}>
                {latest.model}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-alabaster overflow-hidden" aria-hidden="true">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-[var(--motion-fast)]",
                  TONE_BAR[latest.conversationBudget.used > latest.conversationBudget.max ? "danger" : latest.conversationBudget.used >= latest.conversationBudget.compactAt ? "warn" : "ok"]
                )}
                style={{
                  width: `${Math.round(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        latest.conversationBudget.used / Math.max(1, latest.conversationBudget.max)
                      )
                    ) * 100
                  )}%`,
                }}
              />
            </div>
            {windowUsage && (
              <p className="text-[10px] text-sandrift" data-testid="kiro-inspector-context-window">
                {windowUsage.label}
              </p>
            )}
          </div>

          {/* 历史（新 → 旧）：序号 + 占用条 + used/max（compacted 标记） */}
          <ul className="space-y-0.5">
            {rows.map((row) => (
              <li key={row.id}>
                <KiroInspectorRow
                  testId="kiro-inspector-context-row"
                  icon={<span className={cn("block w-1.5 h-1.5 rounded-full mt-[3px]", TONE_BAR[row.tone])} aria-hidden="true" />}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-sandrift shrink-0">#{row.index}</span>
                    <span className="flex-1 min-w-[40px] h-1 rounded-full bg-alabaster overflow-hidden" aria-hidden="true">
                      <span
                        className={cn("block h-full rounded-full", TONE_BAR[row.tone])}
                        style={{ width: `${Math.round(row.ratio * 100)}%` }}
                      />
                    </span>
                    <span className="text-[10px] text-sandrift shrink-0">
                      {formatContextUsageTokens(row.used)}/{formatContextUsageTokens(row.max)}
                      {row.compacted ? " · 已压缩" : ""}
                    </span>
                  </span>
                </KiroInspectorRow>
              </li>
            ))}
          </ul>
        </>
      )}
    </KiroInspectorSection>
  );
}
