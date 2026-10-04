/**
 * Task 7E：Kiro Context Strip 展示纯逻辑（UI grouping / label formatting）。
 * 不接触 Context 数据源 / Prompt 构建 / Picker —— 只负责「怎么展示」。
 *
 * 视觉角色：
 * - ambient：source === "auto"（系统自动环境：当前周 / 当前选中，弱时间图标）
 * - manual：source === "manual"（用户 @ 添加）或 "entry"（Ask Kiro 实体入口 = 显式意图）
 * entry 虽名为 entry，但来自用户点击业务对象上的 Ask Kiro，属于 Explicit Context，
 * 关闭自动上下文时不得受影响，视觉上归入 Manual Token。
 */

import { KiroContextRef } from "@/lib/ai/context/types";

export type KiroContextVisualRole = "ambient" | "manual";

export function getKiroContextVisualRole(
  ref: Pick<KiroContextRef, "source">
): KiroContextVisualRole {
  return ref.source === "auto" ? "ambient" : "manual";
}

export interface KiroContextDisplaySplit {
  visibleAmbient: KiroContextRef[];
  visibleManual: KiroContextRef[];
  overflow: KiroContextRef[];
}

/**
 * 展示数量：Desktop = ambient 1 + manual 2；compact（Sidecar）= ambient 1 + manual 1。
 * 顺序：Ambient → Manual → overflow（+N）。不做像素测量，按 compact prop 决定。
 */
export function splitKiroContextsForDisplay(
  contexts: KiroContextRef[],
  compact: boolean
): KiroContextDisplaySplit {
  const ambient = contexts.filter((c) => getKiroContextVisualRole(c) === "ambient");
  const manual = contexts.filter((c) => getKiroContextVisualRole(c) === "manual");
  const maxAmbient = 1;
  const maxManual = compact ? 1 : 2;
  const visibleAmbient = ambient.slice(0, maxAmbient);
  const visibleManual = manual.slice(0, maxManual);
  const overflow = [...ambient.slice(maxAmbient), ...manual.slice(maxManual)];
  return { visibleAmbient, visibleManual, overflow };
}

/** P1：chip title 用来源说明（此前 hover 只有 label，用户不知自动带了什么、不敢删） */
export function describeKiroContextRef(ref: KiroContextRef): string {
  const kindName: Record<KiroContextRef["kind"], string> = {
    week: "时间范围",
    course: "课程",
    assignment: "任务",
    "group-project": "小组项目",
    material: "课程资料",
    artifact: "工作区文件",
  };
  const origin = ref.source === "auto" ? "自动携带" : ref.source === "manual" ? "手动添加" : "入口添加";
  return `${origin} · ${kindName[ref.kind] ?? ref.kind} · ${ref.label}`;
}

/** 展示用 label 轻量规范化（只影响 UI，绝不改传给模型的 label）。无法可靠识别时原样返回。 */
export function formatKiroContextDisplayLabel(ref: KiroContextRef): string {
  if (ref.kind === "week") {
    // 自动：「时间范围 · 本周（第 N 周）」→「本周 · 第 N 周」
    // 入口：「时间范围 · 第 N 周」（Timetable Ask Kiro，当前周）→「本周 · 第 N 周」
    const full = /^时间范围 ·\s*本周（第\s*(\d+)\s*周）$/.exec(ref.label);
    if (full) return `本周 · 第 ${full[1]} 周`;
    const plain = /^时间范围 ·\s*第\s*(\d+)\s*周$/.exec(ref.label);
    if (plain) return `本周 · 第 ${plain[1]} 周`;
    const fallback = /^时间范围 ·\s*(.+)$/.exec(ref.label);
    if (fallback) return fallback[1];
  }
  return ref.label;
}
