"use client";

import React, { useEffect, useState } from "react";
import { Pause, Play, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SkillDistillDialog } from "@/components/kiro/SkillDistillDialog";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import type {
  ClassFlowDesktopComputerAppProfileInfo,
  ClassFlowDesktopComputerSessionStatus,
  ClassFlowDesktopComputerSkillDraftResult,
} from "@/lib/desktop/types";
import { useDesktopSessionStore, isActiveDesktopSessionState } from "@/store/useDesktopSessionStore";
import { useToastStore } from "@/store/useToastStore";

/** Main 侧动作标签 → 人类可读状态文案（Sidecar） */
function describeState(input: {
  state: string | null;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  failureReason?: string | null;
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
}): string {
  // V2.4：优先展示应用画像 label（如「微信」/「浏览器」），更易读
  const app = input.appProfile?.label || input.appName || input.windowTitle || "桌面";
  switch (input.state) {
    case "observing":
      return `正在查看 ${app}`;
    case "acting": {
      const label = input.actionLabel ?? "";
      const prefix = label.startsWith("wait")
        ? "正在等待"
        : label.startsWith("window:activate")
          ? "正在切换窗口"
          : label.startsWith("app:open")
            ? "正在打开应用"
            : label.startsWith("click")
              ? "正在点击"
              : label.startsWith("double_click")
                ? "正在双击"
                : label.startsWith("type")
                  ? "正在输入"
                  : label.startsWith("key")
                    ? "正在按键"
                    : label.startsWith("scroll")
                      ? "正在滚动"
                      : label.startsWith("focus")
                        ? "正在聚焦"
                        : "正在操作界面";
      return `${prefix} · ${app}`;
    }
    case "waiting":
      return `正在等待界面响应 · ${app}`;
    case "approval-required":
      return "等待你的确认";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "已停止（未继续自动尝试）";
    case "cancelled":
      return "已停止";
    default:
      return `正在使用 ${app}`;
  }
}

/** Main session 状态 → Sidecar 事件（同一字段集；避免两处手写漂移） */
function applySessionStatus(status: ClassFlowDesktopComputerSessionStatus): void {
  useDesktopSessionStore.getState().applyEvent({
    type: "session",
    sessionId: status.sessionId,
    state: status.state,
    appName: status.appName,
    windowTitle: status.windowTitle,
    actionLabel: status.actionLabel,
    actions: status.actions,
    observations: status.observations,
    updatedAt: status.updatedAt,
    goal: status.goal,
    plan: status.plan,
    stepIndex: status.stepIndex,
    reflectionRequired: status.reflectionRequired,
    appProfile: status.appProfile ?? null,
  });
}

/**
 * Computer Session 状态卡（Phase 3 Sidecar UX）：
 * - 始终显示 Kiro 当前在操作什么（正在查看 / 正在点击 / 等待确认…）
 * - Pause / Resume / Stop；Stop 最高优先级（派发 classflow:computer:stop → useKiroChat 统一 Stop）
 * - V2.3：计划时间线（第 N/M 步 + 进度点 + 当前步骤）与反思提示
 */
export function KiroComputerSessionCard() {
  const sessionId = useDesktopSessionStore((s) => s.sessionId);
  const state = useDesktopSessionStore((s) => s.state);
  const appName = useDesktopSessionStore((s) => s.appName);
  const windowTitle = useDesktopSessionStore((s) => s.windowTitle);
  const actionLabel = useDesktopSessionStore((s) => s.actionLabel);
  const actions = useDesktopSessionStore((s) => s.actions);
  const plan = useDesktopSessionStore((s) => s.plan);
  const stepIndex = useDesktopSessionStore((s) => s.stepIndex);
  const goal = useDesktopSessionStore((s) => s.goal);
  const reflectionRequired = useDesktopSessionStore((s) => s.reflectionRequired);
  const appProfile = useDesktopSessionStore((s) => s.appProfile);
  // V2.6：完成后的轨迹草稿（点击「保存为 Skill」时向 Main 拉取；不进入模型 context）
  const [skillDraftResult, setSkillDraftResult] = useState<ClassFlowDesktopComputerSkillDraftResult | null>(null);
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const pushToast = useToastStore((s) => s.pushToast);

  // 订阅 Main session 事件（仅 Desktop Runtime；Web 版永不出现）
  useEffect(() => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge) return;
    const unsubscribe = bridge.subscribeSession((event) => {
      useDesktopSessionStore.getState().applyEvent(event);
    });
    return unsubscribe;
  }, []);

  // V2.6：session 完成 → 预取轨迹草稿（只有存在可用能力与足够步骤时才显示按钮）
  useEffect(() => {
    if (state !== "completed" || !sessionId) {
      setSkillDraftResult(null);
      return;
    }
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge?.buildSkillDraft) return;
    let cancelled = false;
    void bridge
      .buildSkillDraft({ sessionId })
      .then((result) => {
        if (!cancelled) setSkillDraftResult(result);
      })
      .catch(() => {
        if (!cancelled) setSkillDraftResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state, sessionId]);

  if (!sessionId || !state) return null;
  if (state === "idle" && actions === 0) return null;

  const active = isActiveDesktopSessionState(state);
  const paused = state === "paused";

  const handlePause = () => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge || !sessionId) return;
    void bridge.pauseSession({ sessionId }).then(applySessionStatus).catch(() => undefined);
  };

  const handleResume = () => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge || !sessionId) return;
    void bridge.resumeSession({ sessionId }).then(applySessionStatus).catch(() => undefined);
  };

  const handleStop = () => {
    // Stop 最高优先级：由 useKiroChat 统一处理（取消 session + 停止当前 turn）
    window.dispatchEvent(new CustomEvent("classflow:computer:stop"));
  };

  return (
    <div
      data-testid="kiro-computer-session-card"
      data-state={state}
      className="mx-3 mt-2 mb-1 rounded-xl border border-line bg-white/80 px-3 py-2 flex flex-col gap-1.5 shrink-0"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            state === "approval-required" || state === "paused"
              ? "w-1.5 h-1.5 rounded-full bg-danger shrink-0"
              : active
                ? "w-1.5 h-1.5 rounded-full bg-pastel-mint shrink-0 animate-pulse"
                : "w-1.5 h-1.5 rounded-full bg-sandrift shrink-0"
          }
        />
        <p className="text-[11px] font-semibold text-charcoal truncate flex-1 min-w-0">
          {describeState({ state, appName, windowTitle, actionLabel, appProfile })}
        </p>
        {appProfile?.blocked && (
          <span
            className="text-[10px] font-bold text-danger shrink-0"
            data-testid="computer-session-profile-blocked"
          >
            受保护应用
          </span>
        )}
        {active && (
          <div className="flex items-center gap-1 shrink-0">
            {paused ? (
              <Button variant="ghost" size="sm" onClick={handleResume} data-testid="computer-session-resume">
                <Play className="w-3 h-3" />
                继续
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={handlePause} data-testid="computer-session-pause">
                <Pause className="w-3 h-3" />
                暂停
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleStop} data-testid="computer-session-stop">
              <Square className="w-3 h-3" />
              停止
            </Button>
          </div>
        )}
      </div>

      {/* V2.3：计划时间线（有计划时才显示；步骤文本 + 进度） */}
      {plan.length > 0 && (
        <div className="flex items-center gap-2 pl-3.5 min-w-0" data-testid="computer-session-plan">
          <span className="text-[10px] font-bold text-sandrift shrink-0">
            第 {Math.min(stepIndex + 1, plan.length)}/{plan.length} 步
          </span>
          <div className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
            {plan.map((_, index) => (
              <span
                key={index}
                className={
                  index < stepIndex
                    ? "w-1.5 h-1.5 rounded-full bg-success/70"
                    : index === stepIndex
                      ? "w-1.5 h-1.5 rounded-full bg-charcoal"
                      : "w-1.5 h-1.5 rounded-full bg-line-strong"
                }
              />
            ))}
          </div>
          <span className="text-[10px] text-sandrift truncate min-w-0">
            {plan[stepIndex] ?? goal ?? ""}
          </span>
        </div>
      )}

      {/* V2.3：反思提示（连续验证失败 / 无进展） */}
      {reflectionRequired && active && (
        <p className="pl-3.5 text-[10px] font-semibold text-danger" data-testid="computer-session-reflection">
          正在调整策略
        </p>
      )}

      {/* V2.6：成功轨迹 → Skill（desktop-<app>-<task>） */}
      {state === "completed" && skillDraftResult && (
        <div className="flex items-center justify-between gap-2 pl-3.5">
          <span className="text-[10px] text-sandrift truncate min-w-0">
            {skillDraftResult.steps} 步 · 可复用
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSkillDialogOpen(true)}
            data-testid="computer-session-save-skill"
          >
            <Sparkles className="w-3 h-3" />
            保存为 Skill
          </Button>
        </div>
      )}

      <SkillDistillDialog
        open={skillDialogOpen}
        onOpenChange={setSkillDialogOpen}
        trace={null}
        prebuiltDraft={skillDraftResult?.draft ?? null}
        onSaved={(skillName) => {
          pushToast({ type: "success", message: `已保存 Skill：${skillName}` });
        }}
      />
    </div>
  );
}
