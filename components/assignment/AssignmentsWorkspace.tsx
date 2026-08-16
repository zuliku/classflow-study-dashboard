"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KIRO_ICON } from "@/components/layout/navItems";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { QuickAddCard } from "@/components/assignment/QuickAddCard";
import { AssignmentWorkspaceViewBar } from "@/components/assignment/AssignmentWorkspaceViewBar";
import { useAssignmentWorkspaceController } from "@/hooks/useAssignmentWorkspaceController";
import { useAppStore } from "@/store/useAppStore";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";

/**
 * Assignments Workspace（App Chrome V2）：
 * Sticky Chrome = WorkspaceHeader + AssignmentWorkspaceViewBar（外层 sticky，无 magic offset）；
 * Quick Add 位于 Chrome 之下、内容之上；AssignmentTable 收缩为 list/selection/keyboard/rows。
 * 视图/筛选/搜索状态由 useAssignmentWorkspaceController 统一管理（ViewBar 与 Table 共享）。
 */
export function AssignmentsWorkspace() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const assignments = useAppStore((s) => s.assignments);
  const highlightedAssignmentId = useAppStore((s) => s.highlightedAssignmentId);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
  const incompleteCount = assignments.filter((a) => a.status !== "completed").length;
  const handoff = useKiroHandoff();
  const controller = useAssignmentWorkspaceController();

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
            handoff.handoffAssignmentPrompt(
              highlightedAssignmentId,
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
    <div className="flex flex-1 min-h-0 flex-col" data-testid="assignments-tab">
      {/* Sticky Chrome：单一 sticky 容器承载 Header + ViewBar（无独立 top offset） */}
      <div className="sticky top-0 z-20 shrink-0">
        <WorkspaceHeader
          title="任务与 DDL"
          context={`${incompleteCount} 项未完成`}
          actions={headerActions}
          primaryAction={primaryAction}
        />
        <AssignmentWorkspaceViewBar controller={controller} />
      </div>

      <div className="flex flex-1 min-h-0 flex-col space-y-4 p-4 pb-24 md:p-6 md:pb-6">
        {/* Quick Add：Chrome 之下、内容之上（原卡片内 Inline Card 迁移） */}
        <DisclosureRegion open={quickAddOpen}>
          <QuickAddCard
            defaultCourseId={controller.courseFilter !== "all" ? controller.courseFilter : undefined}
            onClose={() => setQuickAddOpen(false)}
          />
        </DisclosureRegion>

        <AssignmentTable
          mode="workspace"
          workspaceController={controller}
          workspaceQuickAddOpen={quickAddOpen}
          onWorkspaceQuickAddOpenChange={setQuickAddOpen}
        />
      </div>
    </div>
  );
}
