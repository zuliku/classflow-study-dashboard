"use client";

import React, { useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarClock, Eye, RefreshCcw, Sparkles, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { StudyRebalanceProposal, StudyRebalanceReason } from "@/lib/planning/studyRebalance";
import {
  applyStudyRebalance,
  createStudyRebalanceProposalKey,
  preflightStudyRebalance,
  RebalanceCourseOverlapInfo,
  RebalanceMoveInput,
  StudyRebalanceApprovalSnapshot,
  undoStudyRebalance,
} from "@/lib/planning/applyStudyRebalance";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  CourseOverlapApprovalList,
  CourseOverlapDisplayItem,
} from "@/components/kiro/CourseOverlapApprovalContent";

type ApplyState = "idle" | "applying" | "applied" | "stale" | "revoked";

/** 旧 payload 可能仍带 course_conflict（Task 6 前生成）→ 不再生成新 reason，显示为 soft 文案 */
const REASON_COPY: Record<StudyRebalanceReason, string> = {
  after_deadline: "原计划晚于截止时间",
  course_conflict: "与课程时间重叠（未确认）",
  fixed_event_conflict: "与考试/活动冲突",
  capacity_relief: "释放较早时间容量",
};

const fmtTime = (t: string) => t.slice(0, 5);
const fmtDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
};

/**
 * Kiro Study Rebalance Proposal Card（事实 UI）：渲染 propose_study_rebalance 的确定性结果。
 * Move-only：只移动已有 Kiro StudyBlock；Preview → Confirm → fresh Preflight → Atomic Apply → Undo。
 * Task 6：Course overlap = soft —— preflight 返回 courseOverlaps 时直接进入批量确认 Dialog
 * （不重复连续弹两个 Dialog），确认后整批一次写入；Undo 不要求课程重叠确认。
 */
export function StudyRebalanceProposalCard({
  proposals,
}: {
  proposals: StudyRebalanceProposal[];
}) {
  const [dismissed, setDismissed] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [pendingApproval, setPendingApproval] = useState<RebalanceCourseOverlapInfo[] | null>(null);
  // Exit payload snapshot：semantic close 后保留最后一次 approval 内容供 exit 淡出渲染
  const shownApprovalRef = useRef<RebalanceCourseOverlapInfo[] | null>(null);
  if (pendingApproval) shownApprovalRef.current = pendingApproval;
  const shownApproval = pendingApproval ?? shownApprovalRef.current;
  const appliedMovesRef = useRef<RebalanceMoveInput[] | null>(null);
  /** Apply 前的 Approval 快照 + Apply 后的状态（Undo 精确恢复 / stale 指纹；V1.1） */
  const originalApprovalsRef = useRef<StudyRebalanceApprovalSnapshot | null>(null);
  const afterApprovalsRef = useRef<StudyRebalanceApprovalSnapshot | null>(null);
  const { studyRebalancePreview, setStudyRebalancePreview, handoffPrompt } = useKiroSession();
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  const proposal = proposals[0];
  const moves = proposal?.moves ?? [];
  const moveInputs = useMemo<RebalanceMoveInput[]>(
    () =>
      moves.map((m) => ({
        blockId: m.blockId,
        from: m.from,
        to: m.to,
      })),
    [moves]
  );
  const proposalKey = useMemo(() => createStudyRebalanceProposalKey(moveInputs), [moveInputs]);
  const previewActive =
    studyRebalancePreview !== null && studyRebalancePreview.proposalKey === proposalKey;

  if (dismissed || !proposal || moves.length === 0) return null;

  /** 执行 Apply（Confirm 后 fresh preflight + 提交；课程重叠需 allowCourseOverlap） */
  const runApply = (options?: { allowCourseOverlap?: boolean }) => {
    const freshState = useAppStore.getState();
    const result = applyStudyRebalance(moveInputs, freshState, options);
    if (!result.ok) {
      setApplyState("stale");
      setStudyRebalancePreview(null);
      return;
    }
    if (result.state === "needs-approval") {
      setPendingApproval(result.courseOverlaps);
      setApplyState("idle");
      return;
    }
    appliedMovesRef.current = moveInputs;
    originalApprovalsRef.current = result.originalApprovals ?? null;
    afterApprovalsRef.current = result.afterApprovals ?? null;
    setApplyState("applied");
    setStudyRebalancePreview(null);
    pushToast({
      message: `已调整 ${moves.length} 个学习时段`,
      actionLabel: "撤销",
      onAction: handleUndo,
    });
  };

  const handleApply = () => {
    if (applyState === "applying") return;
    setApplyState("applying");
    // 第一次 Preflight（展示 Confirm 前）
    const state = useAppStore.getState();
    const preflight = preflightStudyRebalance(moveInputs, state);
    if (!preflight.ok) {
      setApplyState("stale");
      return;
    }
    // 课程重叠：直接进入批量确认 Dialog（承担 Apply confirmation，不重复弹两个 Dialog）
    if (preflight.courseOverlaps.length > 0) {
      setPendingApproval(preflight.courseOverlaps);
      setApplyState("idle");
      return;
    }
    confirmRequest({
      title: "应用学习计划调整",
      description: (
        <p>
          将移动 {moves.length} 个已有 Kiro 学习时段。
          <br />
          不会修改任务、截止时间或你手动安排的学习计划。
        </p>
      ),
      confirmLabel: "应用调整",
      onConfirm: () => runApply(),
      onCancel: () => setApplyState("idle"),
    });
  };

  /** Undo：undoStudyRebalance 确认当前状态仍 == after fingerprint（时间 + Approval）；否则 STALE 提示 */
  const handleUndo = () => {
    const movesRef = appliedMovesRef.current;
    if (!movesRef || movesRef.length === 0) return;
    const result = applyUndo(
      movesRef,
      originalApprovalsRef.current ?? undefined,
      afterApprovalsRef.current ?? undefined
    );
    if (!result.ok) {
      pushToast({ message: "学习计划之后又发生了变化，无法安全撤销本次调整。", type: "error" });
      return;
    }
    appliedMovesRef.current = null;
    originalApprovalsRef.current = null;
    afterApprovalsRef.current = null;
    setApplyState("revoked");
  };

  const handlePreview = () => {
    if (previewActive) {
      setStudyRebalancePreview(null);
      return;
    }
    setStudyRebalancePreview({
      proposalKey,
      moves: moves.map((m) => ({
        blockId: m.blockId,
        from: m.from,
        to: m.to,
        title: m.title,
        assignmentId: m.assignmentId,
        courseId: m.courseId,
      })),
    });
    setActiveTab("timetable");
  };

  const handleRegenerate = () => {
    setDismissed(true);
    setStudyRebalancePreview(null);
    handoffPrompt("当前学习安排已变化，请根据最新学习前瞻重新生成刚才的学习计划调整建议。");
  };

  const renderActions = () => {
    if (applyState === "applying") {
      return (
        <button disabled className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal opacity-60">
          应用中…
        </button>
      );
    }
    if (applyState === "applied") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-[#627566]">已应用调整</span>
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
        <button
          onClick={handleApply}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          重新应用
        </button>
      );
    }
    return (
      <>
        <button
          onClick={handlePreview}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {previewActive ? "收起预览" : "预览调整"}
        </button>
        <button
          onClick={handleApply}
          data-testid="study-rebalance-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          应用调整
        </button>
      </>
    );
  };

  const renderStatus = () => {
    if (applyState === "stale") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-danger">
          调整建议已过期，当前课表或学习计划已经变化。
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
      data-testid="study-rebalance-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3 kiro-structure-settle"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <CalendarClock className="w-3.5 h-3.5 text-[#A48F82]" />
          学习计划调整建议
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="text-[10px] text-sandrift">
        移动 {proposal.summary.movedBlocks} 个时段 · {proposal.summary.movedMinutes} 分钟
        {proposal.summary.shortfallBefore > 0 && (
          <span className="ml-1.5">
            容量缺口：{Math.round(proposal.summary.shortfallBefore)}min →{" "}
            {Math.round(proposal.summary.shortfallAfter)}min
          </span>
        )}
      </div>

      <div className="space-y-2">
        {moves.map((m) => (
          <div key={m.blockId} className="space-y-0.5">
            <p className="text-[11px] font-semibold text-charcoal leading-snug">{m.title}</p>
            <p className="text-[10px] text-satin-grey font-mono tabular-nums">
              {fmtDay(m.from.date)} {fmtTime(m.from.startTime)}–{fmtTime(m.from.endTime)}
              <ArrowRight className="w-3 h-3 inline mx-1 text-sandrift" />
              {fmtDay(m.to.date)} {fmtTime(m.to.startTime)}–{fmtTime(m.to.endTime)}
            </p>
            <p className="text-[10px] text-sandrift">
              原因：{REASON_COPY[m.reason] ?? "原安排与课程时间重叠"}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-line-soft">
        {renderStatus()}
        {renderActions()}
      </div>

      {/* Task 6 Approval Gate：Rebalance 与课程重叠 → 写入前批量确认一次（all-or-nothing）。
          Motion V2.1：Dialog 常驻，open 表达 semantic state；payload snapshot 供 exit 淡出渲染 */}
      <Dialog
        open={!!pendingApproval}
        onOpenChange={(next) => {
          if (!next) setPendingApproval(null);
        }}
        overlayId="kiro-rebalance-course-overlap-approval"
        stackZ={60}
        aria-label="学习计划调整与课程时间重叠"
        aria-hidden={!pendingApproval || undefined}
        className={cn("max-w-md", !pendingApproval && "pointer-events-none")}
      >
          <div className="p-5 space-y-3">
            <h3 className="text-base font-bold text-charcoal">学习计划调整与课程时间重叠</h3>
            <p className="text-xs leading-relaxed text-satin-grey">
              Kiro 的这次调整中有 {(shownApproval?.length ?? 0)} 个学习时段会与课程时间重叠。
              确认后将一次性应用全部调整。
            </p>
            <p className="text-[11px] leading-relaxed text-sandrift">
              选择「仍然调整」后，ClassFlow 会将当前课程重叠视为你已确认的例外。
              <br />
              如果之后课程时间发生变化，会重新检查。
            </p>
            <CourseOverlapApprovalList
              items={(shownApproval ?? []).map(
                (o): CourseOverlapDisplayItem => ({
                  key: `${o.moveIndex}-${o.blockId}`,
                  title: o.title,
                  date: o.date,
                  startTime: o.startTime,
                  endTime: o.endTime,
                  courseName: o.courseName,
                })
              )}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setPendingApproval(null)}>
                返回调整
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setPendingApproval(null);
                  runApply({ allowCourseOverlap: true });
                }}
              >
                仍然调整
              </Button>
            </div>
          </div>
      </Dialog>
    </div>
  );
}

/** Undo：经 undoStudyRebalance（fresh fingerprint 校验，含 Approval 快照恢复）；返回结果供 toast 分支 */
function applyUndo(
  moves: RebalanceMoveInput[],
  originalApprovals?: StudyRebalanceApprovalSnapshot,
  afterApprovals?: StudyRebalanceApprovalSnapshot
) {
  return undoStudyRebalance(
    moves,
    useAppStore.getState(),
    originalApprovals || afterApprovals
      ? { originalApprovals: originalApprovals ?? {}, afterApprovals: afterApprovals ?? {} }
      : undefined
  );
}
