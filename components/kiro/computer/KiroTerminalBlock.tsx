"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, AlertCircle, XCircle, Loader2, ChevronDown, Square, Terminal, SendHorizonal } from "lucide-react";
import { TerminalActivity, isTerminalActivityTerminal } from "@/lib/ai/computer/terminal/activity";
import { getClassFlowDesktopTerminalBridge, getClassFlowDesktopTerminalBridgeV2 } from "@/lib/desktop/bridge";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

/**
 * KiroTerminalBlock —— Terminal Activity 专用展示（V2 Streaming UI）。
 * - 视觉沿用 ClassFlow 奶油白 / 淡灰 / 柔和边框语言（非黑底终端）。
 * - 输出 bounded：默认只显示最近若干行 + max-height；「查看全部输出」展开 bounded scroll region。
 * - elapsed 由本地 tick 驱动（只 re-render 本 block；不触发上层）。
 * - running 时 [停止] → bridge.cancel（幂等；Stop Kiro 已由 executor registry 覆盖）。
 * - 绝不显示 PID / native absolute path / secret（事件与 preview 已在 runtime/executor 层 redacted）。
 */
const PREVIEW_LINES = 10;

function elapsedLabel(activity: TerminalActivity, now: number): string {
  const total = activity.durationMs > 0 ? activity.durationMs : Math.max(0, now - activity.startedAt);
  if (total < 1000) return `${total}ms`;
  return `${(total / 1000).toFixed(1)}s`;
}

function statusMeta(activity: TerminalActivity): { icon: React.ReactNode; label: string; tone: string } {
  switch (activity.status) {
    case "starting":
    case "running":
    case "stopping":
    case "waiting-input":
      return {
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />,
        label: activity.status === "waiting-input" ? "等待输入" : activity.status === "stopping" ? "正在停止" : "运行中",
        tone: "text-sandrift",
      };
    case "completed":
      return {
        icon: <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />,
        label: activity.exitCode === 0 ? `已完成 · exit ${activity.exitCode}` : `exit ${activity.exitCode}`,
        tone: "text-satin-grey",
      };
    case "failed":
      return {
        icon: <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />,
        label: `失败 · exit ${activity.exitCode}`,
        tone: "text-danger",
      };
    case "cancelled":
      return {
        icon: <XCircle className="w-3.5 h-3.5 text-satin-grey shrink-0" aria-hidden="true" />,
        label: "已停止",
        tone: "text-satin-grey",
      };
    case "timed-out":
      return {
        icon: <XCircle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />,
        label: "已超时",
        tone: "text-danger",
      };
  }
}

export const KiroTerminalBlock = React.memo(function KiroTerminalBlock({
  activity,
}: {
  activity: TerminalActivity;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputBusy, setInputBusy] = useState(false);
  const [inputSent, setInputSent] = useState(false);
  const running = !isTerminalActivityTerminal(activity.status);
  const cancelling = stopping;

  // elapsed tick：运行中每 500ms 刷新（仅本 block 内部状态）
  useEffect(() => {
    if (!running || cancelling) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running, cancelling]);

  // secure input：用户手动输入 → bridgeV2.write（绝不进入模型 context / 对话历史 / audit）
  const onSendInput = async () => {
    const text = inputValue;
    if (!text.trim() || inputBusy) return;
    setInputBusy(true);
    try {
      const bridgeV2 = getClassFlowDesktopTerminalBridgeV2();
      if (!bridgeV2) return;
      const payload = text.endsWith("\n") ? text : `${text}\n`;
      await bridgeV2.write({ executionId: activity.executionId, data: payload });
      setInputValue("");
      setInputSent(true);
      window.setTimeout(() => setInputSent(false), 1200);
    } catch {
      /* write 失败（进程已结束等）：静默 */
    } finally {
      setInputBusy(false);
    }
  };

  const body = [...activity.stdoutLines, ...activity.stderrLines.map((l) => `  ${l}`)];
  const displayLines = showAll ? body : body.slice(-PREVIEW_LINES);
  const meta = statusMeta(activity);
  const shellLabel = activity.shell === "powershell" ? "PowerShell" : "命令提示符";

  const onStop = async () => {
    if (cancelling) return;
    setStopping(true);
    const bridge = getClassFlowDesktopTerminalBridge();
    if (!bridge) return;
    try {
      await bridge.cancel({ executionId: activity.executionId });
    } catch {
      /* cancel 失败：executor registry / timeout 兜底 */
    }
  };

  return (
    <div
      data-testid="kiro-terminal-block"
      className="rounded-xl border border-line-soft bg-alabaster/40 overflow-hidden"
    >
      {/* Header：icon + shell + elapsed + status + collapse */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <Terminal className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-charcoal truncate">{shellLabel}</span>
        <span className="text-[10px] text-satin-grey tabular-nums shrink-0 ml-1">
          {elapsedLabel(activity, now)}
        </span>
        <span className={cn("text-[10px] flex items-center gap-1 shrink-0 ml-1", meta.tone)}>
          {meta.icon}
          {meta.label}
        </span>
        {running && (
          <button
            type="button"
            data-testid="kiro-terminal-stop"
            onClick={onStop}
            disabled={cancelling}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-satin-grey hover:text-danger hover:bg-danger-bg/40 border border-line-soft transition-colors disabled:opacity-50"
          >
            <Square className="w-2.5 h-2.5" aria-hidden="true" />
            {cancelling ? "正在停止" : "停止"}
          </button>
        )}
        <button
          type="button"
          data-testid="kiro-terminal-input-toggle"
          onClick={() => setInputOpen((v) => !v)}
          aria-expanded={inputOpen}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-satin-grey hover:text-charcoal hover:bg-alabaster border border-line-soft transition-colors ml-1"
        >
          <SendHorizonal className="w-2.5 h-2.5" aria-hidden="true" />
          输入
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="ml-0.5 flex items-center justify-center w-5 h-5 rounded-md text-satin-grey hover:bg-alabaster transition-colors"
          aria-label={expanded ? "折叠终端输出" : "展开终端输出"}
        >
          <ChevronDown
            className={cn("w-3.5 h-3.5 transition-transform duration-[var(--motion-fast)]", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Secure stdin（Phase 3）：本地安全输入路径——不经模型 / 历史 / audit */}
      {inputOpen && (
        <div className="px-2.5 pb-1.5" data-testid="kiro-terminal-input">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSendInput();
                }
              }}
              placeholder="向进程输入（敏感内容请在此输入，不会发送给模型）"
              aria-label="向进程输入"
              className="min-w-0 flex-1 rounded-lg border border-line-soft bg-white/70 px-2 py-1 text-[11px] font-mono text-charcoal outline-none focus:border-sandrift"
            />
            <button
              type="button"
              data-testid="kiro-terminal-input-send"
              onClick={() => void onSendInput()}
              disabled={inputBusy || !inputValue.trim()}
              className="rounded-lg px-2 py-1 text-[10px] font-medium text-white bg-sandrift hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {inputSent ? "已发送" : inputBusy ? "发送中" : "发送"}
            </button>
          </div>
        </div>
      )}

      {/* Command preview（sanitized；等宽块） */}
      <div className="px-2.5 pb-1">
        <code className="block text-[11px] leading-relaxed font-mono text-charcoal whitespace-pre-wrap break-all rounded-lg bg-white/60 border border-line-soft px-2 py-1">
          {activity.commandPreview}
        </code>
      </div>

      <DisclosureRegion open={expanded} innerClassName="px-2.5 pb-2">
        {activity.waitingForInput && (
          <div className="mb-1 text-[10px] text-sandrift flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" />
            PowerShell 正在等待输入
          </div>
        )}
        {body.length > 0 ? (
          <div
            data-testid="kiro-terminal-output"
            className={cn(
              "rounded-lg bg-white/70 border border-line-soft px-2 py-1 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all overflow-y-auto",
              !showAll ? "max-h-40" : "max-h-64"
            )}
          >
            {displayLines.map((line, i) => (
              <div key={i} className={cn(line.startsWith("  ") ? "text-satin-grey" : "text-charcoal")}>
                {line}
              </div>
            ))}
            {activity.truncated && (
              <div className="text-[9.5px] text-satin-grey">… 输出过长，仅保留最近部分</div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-satin-grey px-1 py-0.5">（无输出）</div>
        )}
        {body.length > PREVIEW_LINES && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 text-[10px] font-medium text-sandrift hover:text-charcoal transition-colors"
          >
            {showAll ? "收起输出" : `查看全部输出（${body.length} 行）`}
          </button>
        )}
      </DisclosureRegion>
    </div>
  );
}, (prev, next) => {
  const a = prev.activity;
  const b = next.activity;
  if (a === b) return true;
  return (
    a.executionId === b.executionId &&
    a.status === b.status &&
    a.exitCode === b.exitCode &&
    a.durationMs === b.durationMs &&
    a.waitingForInput === b.waitingForInput &&
    a.stdoutLines === b.stdoutLines &&
    a.stderrLines === b.stderrLines &&
    a.commandPreview === b.commandPreview
  );
});
