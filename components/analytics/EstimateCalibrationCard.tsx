"use client";

import React from "react";
import { Scale } from "lucide-react";
import { EstimateCalibration } from "@/lib/analytics/estimateCalibration";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";

const ESTIMATE_KIRO_PROMPT =
  "结合我的估时记录和未来任务，帮我判断哪些任务的预计耗时值得重新检查。先给建议，不要直接修改任务。";

const INTERPRETATION_COPY: Record<string, string> = {
  "tracked-below-estimate": "你的 ClassFlow 专注记录通常低于任务估时。",
  "roughly-aligned": "你的 ClassFlow 专注记录与任务估时大致相符。",
  "tracked-above-estimate": "你的 ClassFlow 专注记录通常高于任务估时。",
};

/**
 * 估时参考（Estimate Calibration）轻量 Card。
 * 样本不足不展示伪精确数字；只报"已记录专注与估时"的对比事实，不评价、不自动校准。
 */
export function EstimateCalibrationCard({ calibration }: { calibration: EstimateCalibration }) {
  const { handoffPrompt } = useKiroSessionActions();

  if (calibration.status !== "ready" || calibration.medianRatio === null) {
    return (
    <div className="w-full min-w-0 bg-surface border border-line rounded-2xl p-4" data-testid="estimate-calibration-card">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
          <Scale className="w-4 h-4 text-[#A48F82]" />
          估时参考
        </h3>
        <p className="py-3 text-[11px] text-sandrift leading-relaxed">
          继续积累任务估时与关联专注记录后，这里会提供个人估时参考。
        </p>
      </div>
    );
  }

  const ratio = calibration.medianRatio;
  const ratioLabel = `${ratio.toFixed(1)}×`;
  const interpretation = INTERPRETATION_COPY[calibration.interpretation ?? ""] ?? "";

  return (
    <div className="w-full min-w-0 bg-surface border border-line rounded-2xl p-4" data-testid="estimate-calibration-card">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
        <Scale className="w-4 h-4 text-[#A48F82]" />
        估时参考
      </h3>
      <div className="pt-2 space-y-1">
        <p className="text-[11px] text-satin-grey leading-relaxed">
          过去 {calibration.sampleCount} 个有完整记录的任务中，已记录专注时长中位数约为预计耗时的{" "}
          <span className="font-bold text-charcoal">{ratioLabel}</span>。
        </p>
        {interpretation && <p className="text-[11px] text-satin-grey">{interpretation}</p>}
        {calibration.excludedOutliers > 0 && (
          <p className="text-[10px] text-sandrift">
            另有 {calibration.excludedOutliers} 个极端样本未纳入参考。
          </p>
        )}
      </div>
      <div className="pt-2 mt-1 flex flex-wrap items-center gap-1.5">
        <KiroFlowButton
          icon={KiroLogoIcon}
          label="问 Kiro"
          size="sm"
          onClick={() => handoffPrompt(ESTIMATE_KIRO_PROMPT)}
        />
      </div>
    </div>
  );
}
