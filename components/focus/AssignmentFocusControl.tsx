"use client";

import React from "react";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FocusSession } from "@/types";
import { useFocusClock } from "@/hooks/useFocusClock";
import { cn } from "@/lib/utils";

/**
 * Task Execution Loop V1：当前任务的活跃 Focus 控制条（current relation）。
 * - running：mint tint 圆点 + 剩余时钟；paused：灰态 + 冻结时钟
 * - 暂停 / 继续 / 结束专注（finish = manual 提前结束，Toast 由父级完成）
 * - 1s tick 只存在于本组件内（useFocusClock），不波及 Drawer 其余部分
 */
export function AssignmentFocusControl({
  session,
  onPause,
  onResume,
  onFinish,
}: {
  session: FocusSession;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}) {
  const { remainingText } = useFocusClock(session);
  const running = session.status === "running";

  return (
    <div
      data-testid="assignment-focus-control"
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2",
        running ? "border-pastel-mint/70 bg-pastel-mint/40" : "border-line bg-alabaster/70"
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {running ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E7D5B]" />
            <span className="truncate text-[11px] font-bold text-charcoal">
              专注中 · 剩余 {remainingText}
            </span>
          </>
        ) : (
          <>
            <Pause className="h-3 w-3 shrink-0 text-satin-grey" />
            <span className="truncate text-[11px] font-bold text-satin-grey">
              已暂停 · 剩余 {remainingText}
            </span>
          </>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {running ? (
          <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" onClick={onPause}>
            <Pause className="h-3 w-3" />
            暂停
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" onClick={onResume}>
            <Play className="h-3 w-3" />
            继续
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-[11px] text-satin-grey"
          onClick={onFinish}
        >
          <Square className="h-3 w-3" />
          结束专注
        </Button>
      </div>
    </div>
  );
}
