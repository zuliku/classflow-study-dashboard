"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KIRO_ICON } from "@/components/layout/navItems";
import { useAppStore } from "@/store/useAppStore";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";

/**
 * Assignments Workspace（UI Productization Task 1）：
 * 职责 ONLY —— WorkspaceHeader + Header actions + Quick Add open state + AssignmentTable workspace。
 * Task View 业务（视图/筛选/键盘导航/Peek/Bulk）全部留在 AssignmentTable。
 */
export function AssignmentsWorkspace() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const assignments = useAppStore((s) => s.assignments);
  const highlightedAssignmentId = useAppStore((s) => s.highlightedAssignmentId);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
  const incompleteCount = assignments.filter((a) => a.status !== "completed").length;
  const handoff = useKiroHandoff();

  const headerActions = (
    <>
      <KiroFlowButton
        icon={KIRO_ICON}
        label="Ask Kiro"
        size="sm"
        className="h-8"
        onClick={() =>
          highlightedAssignmentId
            ? handoff.openForAssignment(highlightedAssignmentId)
            : handoff.openForWeek(currentSemesterWeek)
        }
      />
      {highlightedAssignmentId ? (
        <button
          type="button"
          onClick={() => {
            handoff.openForAssignment(highlightedAssignmentId);
            handoff.handoffPrompt(
              "帮我拆解这个任务，拆成 2–8 个可执行的步骤，并估算每步和总耗时。"
            );
          }}
          title="Kiro 拆解当前高亮任务"
          className="ux-press hidden h-8 rounded-lg border border-line bg-alabaster px-2.5 text-[11px] font-bold text-charcoal transition-colors hover:bg-line-soft lg:inline-flex lg:items-center"
        >
          帮我拆解当前任务
        </button>
      ) : null}
    </>
  );

  const primaryAction = (
    <Button
      variant="primary"
      size="sm"
      aria-expanded={quickAddOpen}
      onClick={() => setQuickAddOpen((v) => !v)}
    >
      <Plus className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{quickAddOpen ? "收起" : "新增任务"}</span>
      <span className="sm:hidden">{quickAddOpen ? "收起" : "新增"}</span>
    </Button>
  );

  return (
    <div className="space-y-4" data-testid="assignments-tab">
      <WorkspaceHeader
        title="任务与 DDL"
        context={`${incompleteCount} 项未完成`}
        actions={headerActions}
        primaryAction={primaryAction}
        sticky
      />
      <AssignmentTable
        mode="workspace"
        workspaceQuickAddOpen={quickAddOpen}
        onWorkspaceQuickAddOpenChange={setQuickAddOpen}
      />
    </div>
  );
}
