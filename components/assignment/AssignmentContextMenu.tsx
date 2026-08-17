"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CalendarClock, ChevronRight, Flag } from "lucide-react";
import { AppCommand } from "@/lib/commands";
import { computeContextMenuPosition } from "@/lib/contextMenuPosition";
import { cn } from "@/lib/utils";

/**
 * Assignment Workspace Context Menu（Part A 修复）：
 * - createPortal 到 document.body + position: fixed → 不受 overflow / transform / 父容器影响
 * - clientX/clientY（Viewport 坐标）与 fixed 定位坐标系一致
 * - 渲染后按真实尺寸 computeContextMenuPosition（右/下不足翻转，8px clamp，无 magic 高度）
 * - 非 modal：无全屏透明 Backdrop。Outside click 用 document pointerdown 监听，
 *   只关闭菜单、不 preventDefault/stopPropagation → 点击另一个 Row 的第一次点击立即生效
 * - scroll（capture）/ resize 关闭菜单
 * - Priority / DDL 使用 drill-in 子视图，主菜单保持 ~7 行以内
 */
export interface AssignmentContextMenuAnchor {
  anchorX: number;
  anchorY: number;
  ids: string[];
  highlightedId: string | null;
}

type MenuView = "main" | "priority" | "ddl";

/** 菜单命令：run 已绑定菜单上下文（无参执行） */
export type ContextMenuCommand = AppCommand & { run: () => void };

/** 主菜单紧凑显示名（Command Registry 保留完整 label 供 Command Center 使用） */
const SHORT_LABELS: Record<string, string> = {
  "ctx-open": "打开任务",
  "ctx-edit": "编辑任务",
  "ctx-complete": "标记完成",
  "ctx-doing": "设为进行中",
  "ctx-delete": "删除任务",
};

const PRIORITY_LABELS: Record<string, string> = {
  "ctx-priority-urgent": "紧急",
  "ctx-priority-high": "高",
  "ctx-priority-medium": "中",
  "ctx-priority-low": "低",
};

interface AssignmentContextMenuProps {
  anchor: AssignmentContextMenuAnchor;
  /** 来自 Command Registry 的扁平命令列表（run 已绑定菜单上下文，可无参执行） */
  commands: ContextMenuCommand[];
  /** 目标任务中是否有已设置 DDL（决定「清除截止时间」是否显示） */
  hasDdl: boolean;
  /** 执行命令（run 内部负责关闭菜单） */
  onRun: (cmd: ContextMenuCommand) => void;
  /** date=null 表示清除截止时间 */
  onApplyDDL: (date: string | null) => void;
  onClose: () => void;
}

export function AssignmentContextMenu({
  anchor,
  commands,
  hasDdl,
  onRun,
  onApplyDDL,
  onClose,
}: AssignmentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<MenuView>("main");
  const [ddlDate, setDdlDate] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const find = (id: string) => commands.find((c) => c.id === id);
  const openCmd = find("ctx-open");
  const editCmd = find("ctx-edit");
  const completeCmd = find("ctx-complete");
  const doingCmd = find("ctx-doing");
  const deleteCmd = find("ctx-delete");
  const priorityCmds = commands.filter((c) => c.id.startsWith("ctx-priority-"));

  // 渲染后按真实尺寸定位（view 切换高度变化 → 重新定位）
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    setPos(
      computeContextMenuPosition({
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        menuWidth: el.offsetWidth,
        menuHeight: el.offsetHeight,
      })
    );
  }, [anchor.anchorX, anchor.anchorY, view]);

  // Outside click：只关闭菜单，不拦截原事件（第一次点击立即作用于目标）
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  // Scroll（capture 捕获内部 scroll container）/ Resize → 关闭
  useEffect(() => {
    const onCloseAny = () => onClose();
    window.addEventListener("scroll", onCloseAny, { capture: true });
    window.addEventListener("resize", onCloseAny);
    return () => {
      window.removeEventListener("scroll", onCloseAny, { capture: true });
      window.removeEventListener("resize", onCloseAny);
    };
  }, [onClose]);

  // Esc → 关闭（保持 highlight / selection）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (cmd: ContextMenuCommand | undefined) => {
    if (cmd) onRun(cmd);
  };

  const applyDdl = () => {
    if (!ddlDate) return;
    onApplyDDL(ddlDate);
  };

  const itemCls = (danger = false) =>
    cn(
      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors",
      danger ? "text-danger hover:bg-danger-bg font-bold" : "font-semibold text-charcoal hover:bg-alabaster"
    );

  const renderMain = () => (
    <>
      {openCmd && (
        <button className={itemCls()} onClick={() => run(openCmd)}>
          <openCmd.icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{SHORT_LABELS["ctx-open"] ?? openCmd.label}</span>
        </button>
      )}
      {editCmd && (
        <button className={itemCls()} onClick={() => run(editCmd)}>
          <editCmd.icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{SHORT_LABELS["ctx-edit"] ?? editCmd.label}</span>
        </button>
      )}
      {completeCmd && (
        <>
          <div className="my-1 border-t border-line-soft" />
          <button className={itemCls()} onClick={() => run(completeCmd)}>
            <completeCmd.icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{SHORT_LABELS["ctx-complete"] ?? completeCmd.label}</span>
          </button>
        </>
      )}
      {doingCmd && (
        <button className={itemCls()} onClick={() => run(doingCmd)}>
          <doingCmd.icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{SHORT_LABELS["ctx-doing"] ?? doingCmd.label}</span>
        </button>
      )}
      {priorityCmds.length > 0 && (
        <>
          <div className="my-1 border-t border-line-soft" />
          <button className={itemCls()} onClick={() => setView("priority")}>
            <Flag className="w-3.5 h-3.5 shrink-0 text-satin-grey" />
            <span className="truncate">优先级</span>
            <ChevronRight className="w-3 h-3 ml-auto shrink-0 text-sandrift" />
          </button>
        </>
      )}
      <button className={itemCls()} onClick={() => setView("ddl")}>
        <CalendarClock className="w-3.5 h-3.5 shrink-0 text-satin-grey" />
        <span className="truncate">调整截止时间</span>
        <ChevronRight className="w-3 h-3 ml-auto shrink-0 text-sandrift" />
      </button>
      {deleteCmd && (
        <>
          <div className="my-1 border-t border-line-soft" />
          <button className={itemCls(true)} onClick={() => run(deleteCmd)}>
            <deleteCmd.icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{SHORT_LABELS["ctx-delete"] ?? deleteCmd.label}</span>
          </button>
        </>
      )}
    </>
  );

  const renderPriority = () => (
    <>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left font-semibold text-satin-grey hover:bg-alabaster transition-colors"
        onClick={() => setView("main")}
      >
        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">优先级</span>
      </button>
      <div className="my-1 border-t border-line-soft" />
      {priorityCmds.map((cmd) => (
        <button key={cmd.id} className={itemCls()} onClick={() => run(cmd)}>
          <cmd.icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{PRIORITY_LABELS[cmd.id] ?? cmd.label}</span>
        </button>
      ))}
    </>
  );

  const renderDdl = () => (
    <>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left font-semibold text-satin-grey hover:bg-alabaster transition-colors"
        onClick={() => setView("main")}
      >
        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">截止时间</span>
      </button>
      <div className="my-1 border-t border-line-soft" />
      <div className="px-1.5 py-1 space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={ddlDate}
            onChange={(e) => setDdlDate(e.target.value)}
            className="flex-1 px-1.5 py-1 rounded-lg bg-white border border-line text-[11px] font-mono focus:outline-none min-w-0"
            aria-label="调整截止日期"
          />
          <button
            onClick={applyDdl}
            disabled={!ddlDate}
            className="px-2.5 py-1 rounded-lg font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
          >
            应用
          </button>
        </div>
        <p className="text-[9px] text-sandrift">
          仅修改日期，保留各任务原截止时间
        </p>
        {hasDdl && (
          <button
            onClick={() => onApplyDDL(null)}
            className="w-full px-3 py-1.5 rounded-lg text-left text-[11px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            清除截止时间
          </button>
        )}
      </div>
    </>
  );

  return createPortal(
    <div
      ref={menuRef}
      data-testid="assignment-context-menu"
      className={cn(
        "fixed z-50 w-52 bg-surface border border-line-strong rounded-2xl shadow-card p-1.5 text-xs ux-inline",
        pos ? "opacity-100" : "opacity-0"
      )}
      style={pos ? { left: pos.x, top: pos.y } : { left: anchor.anchorX, top: anchor.anchorY }}
    >
      {view === "priority" ? renderPriority() : view === "ddl" ? renderDdl() : renderMain()}
    </div>,
    document.body
  );
}
