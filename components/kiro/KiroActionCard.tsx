"use client";

import React from "react";
import { CalendarClock, CalendarDays, Plus, Check, ArrowDown, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Action Result Card 视觉组件（Task 0 不连接真实 Action，仅提供可复用的 semantic API）。
 * variant：ddl（任务 DDL 调整预览）/ schedule（排课调整预览）/ create（创建任务预览）。
 * 默认 Empty State 不展示这些 mock card，避免用户误认为 AI 已真实操作。
 */
export function KiroActionCard({
  variant,
  heading,
  title,
  change,
  bullets,
  footer,
  onUndo,
}: {
  variant: "ddl" | "schedule" | "create";
  heading: string;
  title: string;
  /** ddl / schedule：from → to 变更展示 */
  change?: { from: string; to: string };
  /** create：信息要点 */
  bullets?: string[];
  /** 副信息（如 "✓ 未发现时间冲突"） */
  footer?: string;
  onUndo?: () => void;
}) {
  const Icon = variant === "ddl" ? CalendarClock : variant === "schedule" ? CalendarDays : Plus;
  const isCreate = variant === "create";

  return (
    <div
      data-testid="kiro-action-card"
      className="max-w-md rounded-2xl bg-[#F7F5F5] border border-line p-3.5 space-y-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg bg-pastel-mint flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-charcoal" />
        </span>
        <p className="text-xs font-bold text-charcoal">{heading}</p>
      </div>

      <p className="text-xs font-bold text-charcoal pl-8">{title}</p>

      {!isCreate && change && (
        <div className="pl-8">
          <p className="text-[11px] text-sandrift">{change.from}</p>
          <ArrowDown className="w-3 h-3 text-sandrift my-0.5" />
          <p className="text-[11px] font-bold text-charcoal">{change.to}</p>
        </div>
      )}

      {isCreate && bullets && (
        <ul className="pl-8 space-y-1">
          {bullets.map((b) => (
            <li key={b} className="text-[11px] text-satin-grey flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" />
              {b}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pl-8 pt-1">
        {footer ? (
          <span
            className={cn(
              "text-[10px] font-semibold flex items-center gap-1",
              footer.startsWith("✓") ? "text-success" : "text-sandrift"
            )}
          >
            {footer.startsWith("✓") && <Check className="w-3 h-3" />}
            {footer}
          </span>
        ) : (
          <span />
        )}
        {onUndo && (
          <button
            onClick={onUndo}
            className="flex items-center gap-1 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            撤销
          </button>
        )}
      </div>
    </div>
  );
}
