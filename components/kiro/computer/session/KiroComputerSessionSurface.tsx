"use client";

import React from "react";
import { Sparkles, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SkillDistillDialog } from "@/components/kiro/SkillDistillDialog";
import { KiroComputerSessionHeader } from "@/components/kiro/computer/session/KiroComputerSessionHeader";
import { KiroComputerSessionProgress } from "@/components/kiro/computer/session/KiroComputerSessionProgress";
import { KiroComputerSessionPreview } from "@/components/kiro/computer/session/KiroComputerSessionPreview";
import { useKiroComputerSessionActions } from "@/components/kiro/computer/session/useKiroComputerSessionActions";
import { useKiroComputerSessionSkillDraft } from "@/components/kiro/computer/session/useKiroComputerSessionSkillDraft";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { useToastStore } from "@/store/useToastStore";
import {
  describeDesktopSessionState,
  formatDesktopSessionProgress,
  isDesktopSessionTerminalState,
  resolveDesktopSessionControls,
  resolveDesktopSessionTone,
} from "@/lib/ai/ui/kiroComputerSession";
import { cn } from "@/lib/utils";

/**
 * Kiro Computer Session Surface（P5）— Workspace / Sidecar 共用的 Desktop Session Control Surface。
 *
 * 职责（与 Rail / Agent Run / Inline Approval 不重复）：
 * - 当前 Desktop Session 的全局控制：状态 / 当前应用 / 当前步骤 / Pause / Resume / Stop / 最近画面；
 * - 不做 Agent Timeline（属于 Agent Run）、不做 Approval 决策（属于 Inline Approval）、
 *   不做 Outputs / Sources（属于 Inspector）；
 * - 只消费真实 Runtime fact（Desktop Session store + preview store）；
 * - 没有 sessionId → 完全不渲染（Computer 开关开启 ≠ Desktop Session 存在）。
 *
 * 注意：Desktop Session subscription ownership 属于 KiroComputerSessionHost（Provider 持久根部），
 * 本组件不订阅任何 Electron event。
 */
export function KiroComputerSessionSurface({
  variant = "workspace",
}: {
  variant?: "workspace" | "sidecar";
}) {
  const compact = variant === "sidecar";

  // 精确 selector（绝不订阅整个 store；preview 只在 Preview 组件内订阅）
  const sessionId = useDesktopSessionStore((s) => s.sessionId);
  const state = useDesktopSessionStore((s) => s.state);
  const appName = useDesktopSessionStore((s) => s.appName);
  const windowTitle = useDesktopSessionStore((s) => s.windowTitle);
  const actionLabel = useDesktopSessionStore((s) => s.actionLabel);
  const appProfile = useDesktopSessionStore((s) => s.appProfile);
  const plan = useDesktopSessionStore((s) => s.plan);
  const stepIndex = useDesktopSessionStore((s) => s.stepIndex);
  const goal = useDesktopSessionStore((s) => s.goal);
  const reflectionRequired = useDesktopSessionStore((s) => s.reflectionRequired);
  const failureReason = useDesktopSessionStore((s) => s.failureReason);
  const dismissedSessionId = useDesktopSessionStore((s) => s.dismissedSessionId);
  const setDismissedSessionId = useDesktopSessionStore((s) => s.setDismissedSessionId);
  // 后台静默执行常驻指示（用户看不见实时界面时的唯一 live 信号；terminal 后不展示）
  const backgroundActive = useDesktopSessionStore((s) => s.backgroundActive);

  const { pending, pause, resume, stop } = useKiroComputerSessionActions();
  const skillDraft = useKiroComputerSessionSkillDraft({ sessionId, state });
  const pushToast = useToastStore((s) => s.pushToast);
  const [skillDialogOpen, setSkillDialogOpen] = React.useState(false);

  if (!sessionId || !state) return null;

  const terminal = isDesktopSessionTerminalState(state);
  // terminal surface 允许 UI-only 收起；active session 的 Pause / Stop 不可被隐藏
  if (terminal && dismissedSessionId === sessionId) return null;

  const statusText = describeDesktopSessionState({ state, appName, windowTitle, actionLabel, appProfile });
  const tone = resolveDesktopSessionTone({ state, reflectionRequired });
  const controls = resolveDesktopSessionControls({ state });
  const progress = formatDesktopSessionProgress({ plan, stepIndex, goal });
  const blocked = appProfile?.blocked === true;
  // 只在进行中展示 reflection 提示（terminal 后不再提示策略调整）
  const showReflection = reflectionRequired && !terminal;

  // 整块出现淡入（只进不出：退出保留需 stale 会话快照 + 停用全部控制，成本高于收益；
  // 会话清空本就低频，且 terminal 态常驻，卸载几乎无感知）
  return (
    <section
      data-testid="kiro-computer-session-surface"
      data-state={state}
      role="region"
      aria-label="Kiro 电脑操作"
      className={cn("shrink-0 animate-enter", compact ? "px-3 pt-2" : "pt-2")}
    >
      <div className={cn("mx-auto w-full", compact ? "" : "max-w-[820px] px-1")}>
        <div
          className={cn(
            "rounded-xl border border-line bg-white/80 px-3 py-2 flex flex-col gap-1.5",
            terminal && "bg-surface/70"
          )}
        >
          <KiroComputerSessionHeader
            statusText={statusText}
            tone={tone}
            blocked={blocked}
            stepLabel={progress.stepLabel}
            controls={controls}
            pending={pending}
            onPause={() => void pause(sessionId)}
            onResume={() => void resume(sessionId)}
            onStop={stop}
            onDismiss={terminal ? () => setDismissedSessionId(sessionId) : undefined}
          />

          <KiroComputerSessionProgress
            stepLabel={progress.stepLabel}
            currentStep={progress.currentStep}
          />

          {/* failed：只展示 Main 已 sanitized 的短句（绝不回显 raw exception / stack） */}
          {state === "failed" && failureReason && (
            <p data-testid="computer-session-failure" className="pl-3.5 text-[10px] text-danger animate-enter">
              {failureReason}
            </p>
          )}

          {showReflection && (
            <p
              data-testid="computer-session-reflection"
              className="pl-3.5 text-[10px] font-semibold text-warning animate-enter"
            >
              正在调整策略
            </p>
          )}

          {/* 后台静默执行中：界面不可见，仅执行记录可查（terminal 后不再展示）；
              状态灯语义，随执行通断频繁切换，不加进退场（避免反复重播） */}
          {backgroundActive && !terminal && (
            <p
              data-testid="computer-session-background"
              className="pl-3.5 text-[10px] font-semibold text-satin-grey flex items-center gap-1.5"
            >
              <EyeOff className="w-3 h-3" aria-hidden="true" />
              后台执行中（界面不可见）
            </p>
          )}

          {/* 最近画面：只消费已存在的真实观察证据（绝不主动 observe）；terminal 后不再展示 */}
          {!terminal && <KiroComputerSessionPreview sessionId={sessionId} />}

          {/* completed：降权 terminal surface + 可选保存为 Skill（不显示 Pause / Stop） */}
          {state === "completed" && skillDraft && (
            <div className="flex items-center justify-between gap-2 pl-3.5 animate-enter">
              <span className="text-[10px] text-sandrift truncate min-w-0">
                {skillDraft.steps} 步 · 可复用
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
        </div>
      </div>

      <SkillDistillDialog
        open={skillDialogOpen}
        onOpenChange={setSkillDialogOpen}
        trace={null}
        prebuiltDraft={skillDraft?.draft ?? null}
        onSaved={(skillName) => {
          pushToast({ message: `已保存 Skill：${skillName}` });
        }}
      />
    </section>
  );
}
