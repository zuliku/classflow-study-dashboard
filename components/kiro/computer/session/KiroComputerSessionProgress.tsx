"use client";

import React from "react";

/**
 * Computer Session Progress（P5 §16）：只展示当前步骤（第 N/M 步 + 当前步骤文本）。
 * 绝不展开完整 Plan（Control Surface 不是第二份 Worklog）；
 * plan 为空 → 只显示 goal；都为空 → 不渲染。
 */
export function KiroComputerSessionProgress({
  stepLabel,
  currentStep,
}: {
  stepLabel: string | null;
  currentStep: string | null;
}) {
  if (!stepLabel && !currentStep) return null;
  return (
    <div data-testid="computer-session-plan" className="flex items-center gap-2 pl-3.5 min-w-0">
      {stepLabel && (
        <span className="text-[10px] font-bold text-sandrift shrink-0">{stepLabel}</span>
      )}
      {currentStep && <span className="text-[10px] text-sandrift truncate min-w-0">{currentStep}</span>}
    </div>
  );
}
