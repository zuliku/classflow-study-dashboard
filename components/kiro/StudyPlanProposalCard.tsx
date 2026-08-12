"use client";

import React, { useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarClock, Check, Eye, RefreshCcw, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { StudyPlanProposal } from "@/lib/planning/studyPlanner";
import {
  applyStudyPlan,
  createStudyPlanProposalKey,
  preflightStudyPlan,
  StudyPlanApplyBlockInput,
} from "@/lib/planning/applyStudyPlan";
import { getSemesterWeek } from "@/lib/semester";

type ApplyState = "idle" | "applying" | "applied" | "stale" | "revoked";

/**
 * Kiro Study Plan Proposal Card（事实 UI）：渲染 propose_study_plan 的确定性结果。
 * Task 4B：Preview → Confirm（useConfirmStore）→ Re-preflight（最新 Store）→ Atomic Apply（source="kiro"）→ Undo。
 * 所有 Preflight / 校验逻辑在 lib/planning/applyStudyPlan.ts；组件只编排流程，不重复实现安全规则。
 * Ghost 是 ephemeral（不写 Store / localStorage）；真实 Apply 的 StudyBlock 才进入持久化 Store。
 */
export function StudyPlanProposalCard({ proposals }: { proposals: StudyPlanProposal[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const createdIdsRef = useRef<string[]>([]);
  const { planningPreview, setPlanningPreview } = useKiroSession();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const semester = useAppStore((s) => s.semester);
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const handoffPrompt = useKiroSession().handoffPrompt;

  const blocks = useMemo(
    () =>
      proposals.flatMap((p) =>
        p.proposedBlocks.map((b) => ({
          id: `${p.assignmentId}-${b.date}-${b.startTime}`,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          title: p.title,
          assignmentId: p.assignmentId,
          courseId: p.courseId,
        }))
      ),
    [proposals]
  );

  const applyBlocks = useMemo<StudyPlanApplyBlockInput[]>(
    () =>
      blocks.map((b) => ({
        assignmentId: b.assignmentId,
        title: b.title,
        courseId: b.courseId,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
      })),
    [blocks]
  );

  const proposalKey = useMemo(() => createStudyPlanProposalKey(blocks), [blocks]);
  const previewActive =
    planningPreview !== null &&
    (planningPreview.proposalKey === proposalKey ||
      // 兼容无 key 的旧 Preview：退化为按长度 + id + 时间比较
      (planningPreview.proposalKey === undefined &&
        blocks.length === planningPreview.blocks.length &&
        blocks.every(
          (b, i) =>
            planningPreview.blocks[i] &&
            planningPreview.blocks[i].id === b.id &&
            planningPreview.blocks[i].startTime === b.startTime
        )));

  if (dismissed || proposals.length === 0) return null;

  const taskCount = new Set(blocks.map((b) => b.assignmentId)).size;

  const handlePreview = () => {
    if (previewActive) {
      setPlanningPreview(null);
      return;
    }
    setPlanningPreview({ proposalKey, blocks });
    setActiveTab("timetable");
  };

  /** 预览失败 / stale：清 Ghost，避免用户误以为计划仍有效 */
  const failToStale = () => {
    setApplyState("stale");
    setPlanningPreview(null);
  };

  /** 执行 Apply（Confirm 回调内读取最新 Store 再 Preflight + 提交） */
  const runApply = () => {
    const freshState = useAppStore.getState();
    const result = applyStudyPlan({ blocks: applyBlocks }, freshState);
    if (!result.ok) {
      failToStale();
      return;
    }
    createdIdsRef.current = result.created.map((b) => b.id);
    setApplyState("applied");
    setPlanningPreview(null);
    pushToast({
      message: `已创建 ${result.created.length} 个学习时段`,
      actionLabel: "撤销",
      onAction: handleUndo,
    });
  };

  const handleApply = () => {
    if (applyState === "applying") return; // Double Apply 防护（Domain 侧另有 Duplicate Preflight）
    setApplyState("applying");

    // 第一次 Preflight（展示 Confirm 前）：stale 直接进入过期状态，不弹确认框
    const state = useAppStore.getState();
    const preflight = preflightStudyPlan({ blocks: applyBlocks }, state);
    if (!preflight.ok) {
      failToStale();
      return;
    }

    confirmRequest({
      title: "应用 Kiro 学习计划",
      description: (
        <div className="space-y-1">
          <p>
            准备创建：{blocks.length} 个学习时段
            {taskCount > 0 ? `，涉及 ${taskCount} 个任务` : ""}
          </p>
          <ul className="mt-2 space-y-0.5 text-[11px] text-satin-grey">
            {blocks.slice(0, 6).map((b) => (
              <li key={b.id} className="flex gap-1">
                <span className="text-sandrift">•</span>
                <span>
                  {b.title}
                  <span className="text-sandrift">
                    {" "}
                    {format(parseISO(b.date), "M月d日")} {b.startTime}–{b.endTime}
                  </span>
                </span>
              </li>
            ))}
            {blocks.length > 6 && <li>…还有 {blocks.length - 6} 个时段</li>}
          </ul>
        </div>
      ),
      confirmLabel: "应用计划",
      onConfirm: runApply,
      onCancel: () => setApplyState("idle"),
    });
  };

  /** Undo：只删除本次 Apply 创建的 StudyBlock IDs，不影响此前已有 Block */
  const handleUndo = () => {
    const ids = createdIdsRef.current;
    if (ids.length === 0) return;
    useAppStore.getState().deleteStudyBlocksBatch(ids);
    createdIdsRef.current = [];
    setApplyState("revoked");
    setPlanningPreview(null);
  };

  /** Apply 成功后在时间表中查看：跳到第一个 created block 所在周（不复杂 auto-scroll） */
  const handleViewInTimetable = () => {
    setActiveTab("timetable");
    const first = useAppStore.getState().studyBlocks.find((b) => createdIdsRef.current.includes(b.id));
    if (first) {
      const week = getSemesterWeek(new Date(`${first.date}T00:00:00`), useAppStore.getState().semester);
      if (week >= 1 && week <= useAppStore.getState().semester.totalWeeks) {
        useAppStore.getState().setCurrentSemesterWeek(week);
      }
    }
  };

  /** 重新生成：走 Kiro → Tool Flow（handoffPrompt），UI 不自行调用 Planner */
  const handleRegenerate = () => {
    setDismissed(true);
    handoffPrompt("当前课表或学习计划已变化，请根据最新数据重新生成刚才的学习计划。");
  };

  const renderActions = () => {
    if (applyState === "applying") {
      return (
        <button
          disabled
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal opacity-60"
        >
          应用中…
        </button>
      );
    }
    if (applyState === "applied") {
      return (
        <button
          onClick={handleViewInTimetable}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          在时间表中查看
        </button>
      );
    }
    if (applyState === "stale") {
      return (
        <button
          onClick={handleRegenerate}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
          重新生成
        </button>
      );
    }
    if (applyState === "revoked") {
      return (
        <>
          <button
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            {previewActive ? "收起预览" : "预览计划"}
          </button>
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
          >
            重新应用
          </button>
        </>
      );
    }
    // idle
    return (
      <>
        <button
          onClick={handlePreview}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {previewActive ? "收起预览" : "预览计划"}
        </button>
        <button
          onClick={handleApply}
          data-testid="study-plan-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          应用计划
        </button>
      </>
    );
  };

  const renderStatus = () => {
    if (applyState === "applied") {
      return (
        <span className="mr-auto flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
          <Check className="w-3 h-3" />
          已应用 {blocks.length} 个学习时段
        </span>
      );
    }
    if (applyState === "stale") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-danger">
          计划已过期：当前课表或学习安排发生了变化，需要重新生成计划。
        </span>
      );
    }
    if (applyState === "revoked") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-sandrift">
          计划已撤销，未保留任何新建时段。
        </span>
      );
    }
    return (
      <span className="mr-auto text-[10px] text-sandrift">
        {previewActive ? "正在时间表中预览" : "未写入任何学习计划"}
      </span>
    );
  };

  return (
    <div
      data-testid="study-plan-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3 animate-enter"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <CalendarClock className="w-3.5 h-3.5 text-[#A48F82]" />
          学习计划建议
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        {proposals.map((p) => (
          <div key={p.assignmentId} className="space-y-1">
            <p className="text-[11px] font-semibold text-charcoal leading-snug">{p.title}</p>
            {p.proposedBlocks.length === 0 ? (
              <p className="text-[10px] text-sandrift">已按现有学习计划排满，无需新增。</p>
            ) : (
              <>
                {p.proposedBlocks.map((b, i) => (
                  <p key={i} className="text-[10px] text-satin-grey font-mono tabular-nums">
                    {b.date.slice(5).replace("-", "/")} {b.startTime}–{b.endTime}
                  </p>
                ))}
                <p className="text-[10px] text-sandrift">
                  建议安排 {p.proposedMinutes} 分钟 / 预计 {p.estimatedMinutes ?? "未知"}
                  {p.scheduledMinutes > 0 ? `（已计划 ${p.scheduledMinutes} 分钟）` : ""}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-line-soft">
        {renderStatus()}
        {renderActions()}
      </div>
    </div>
  );
}
