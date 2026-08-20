"use client";

import React, { useEffect, useRef, useState } from "react";
import { Minus, Square, Copy, X, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { getClassFlowDesktopWindowBridge } from "@/lib/desktop/desktopExtras";

/**
 * 桌面版自绘顶部状态栏（替代原生 Windows 标题栏）——紧凑型。
 * 布局参考主流桌面应用：
 * - 左侧：当前学期与周次徽章（全局上下文，轻量）
 * - 中部：可拖拽留白区
 * - 右侧：窗口控制（最小化 / 最大化·还原 / 关闭）
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const semesterName = useAppStore((s) => s.semester?.name);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);

  // Use state to track bridge availability reactively (handles async preload injection)
  const [windowBridge, setWindowBridge] = useState(() => getClassFlowDesktopWindowBridge());
  const [hasDesktopRuntime, setHasDesktopRuntime] = useState(
    () => typeof window !== "undefined" && !!(window as unknown as { classflowDesktop?: unknown }).classflowDesktop
  );
  const windowAvailable = !!windowBridge;
  const warnedRef = useRef(false);

  useEffect(() => {
    // Sanitized debug instrumentation (no secrets)
    const bridgeExists = typeof window !== "undefined" && !!(window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
    const windowBridgeExists = !!getClassFlowDesktopWindowBridge();
    if (process.env.NODE_ENV !== "production") {
      console.log(`[classflow] TitleBar bridgeExists=${bridgeExists} windowBridgeExists=${windowBridgeExists}`);
    }
    // If bridge not yet available, poll briefly for async injection (preload may load after first render)
    if (!windowBridgeExists && !bridgeExists) {
      const id = setInterval(() => {
        const nowBridge = getClassFlowDesktopWindowBridge();
        const nowExists = typeof window !== "undefined" && !!(window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
        if (nowBridge || nowExists) {
          setWindowBridge(nowBridge);
          setHasDesktopRuntime(nowExists);
          clearInterval(id);
        }
      }, 100);
      const timeout = setTimeout(() => clearInterval(id), 2000);
      return () => {
        clearInterval(id);
        clearTimeout(timeout);
      };
    }
    // Update state if bridge becomes available after mount
    setWindowBridge(getClassFlowDesktopWindowBridge());
    setHasDesktopRuntime(bridgeExists);

    if (!windowBridge) {
      if (hasDesktopRuntime && !warnedRef.current && process.env.NODE_ENV !== "production") {
        warnedRef.current = true;
        console.warn("[classflow] desktop window bridge unavailable");
      }
      return;
    }
    void windowBridge.isMaximized().then(setMaximized);
    return windowBridge.onMaximizedChange(setMaximized);
  }, [windowBridge, hasDesktopRuntime]);

  const buttonClass =
    "flex items-center justify-center w-9 h-full text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors duration-[var(--motion-fast)] cursor-default disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <header
      className="flex items-center gap-2 h-[var(--titlebar-h)] shrink-0 px-2 bg-[#F7F5F5] border-b border-line select-none z-[100]"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      data-testid="titlebar"
    >
      {/* 当前学期 · 周次（全局上下文，紧凑显示） */}
      <div
        className="flex items-center gap-1.5 h-[20px] px-2 rounded-md text-[10px] leading-none text-satin-grey hover:text-charcoal transition-colors duration-[var(--motion-fast)]"
        data-testid="titlebar-semester"
      >
        <CalendarDays className="w-3 h-3 shrink-0" strokeWidth={1.75} />
        <span className="whitespace-nowrap">
          {semesterName}
          {typeof currentSemesterWeek === "number" && currentSemesterWeek > 0
            ? ` · 第 ${currentSemesterWeek} 周`
            : ""}
        </span>
      </div>

      {/* 可拖拽留白区 */}
      <div className="flex-1 min-w-0" />

      {/* 窗口控制 */}
      <div
        className="flex items-stretch h-full -mr-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          type="button"
          aria-label="最小化"
          className={buttonClass}
          disabled={!windowAvailable}
          onClick={() => {
            if (!windowBridge) return;
            windowBridge.minimize();
          }}
        >
          <Minus className="w-3 h-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "还原" : "最大化"}
          className={buttonClass}
          disabled={!windowAvailable}
          onClick={() => {
            if (!windowBridge) return;
            windowBridge.toggleMaximize();
          }}
        >
          {maximized ? (
            <Copy className="w-2.5 h-2.5" strokeWidth={1.75} />
          ) : (
            <Square className="w-2.5 h-2.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label="关闭"
          className={cn(buttonClass, "hover:bg-danger hover:text-white disabled:hover:bg-transparent disabled:hover:text-satin-grey")}
          disabled={!windowAvailable}
          onClick={() => {
            if (!windowBridge) return;
            windowBridge.close();
          }}
        >
          <X className="w-3 h-3" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}