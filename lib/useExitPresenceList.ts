import { useEffect, useRef, useState } from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { MOTION_EXIT_MS } from "@/lib/motion";

/**
 * Exit-only 列表保留 helper（Interaction Motion IM4A/IM4B）：
 * 当 item 从 items 消失（真实数据 mutation：删除/完成导致离开当前数据集）时，
 * 保留上一 render 的 snapshot 并标记 exiting，duration 后移出视觉列表。
 *
 * - 只做 exit：新进入的 item 不产生任何 presence（首次渲染列表不播放动画）。
 * - resetKey 改变（切换 View / 筛选 / 搜索 / risk 过滤 / 项目切换）→ 直接同步到新列表，
 *   不保留退出 snapshot，避免大面积 item 同时 collapse/fade。
 *   lifecycle：resetChanged 由 render 判断（输出仅当前 items），状态清理与 gone 检测全部在 effect 中完成
 *   （不在 render 阶段 setState）。
 * - Store mutation 必须在调用方立即执行；本 helper 只保留短暂视觉 snapshot。
 * - 支持批量（多个 item 同时消失）。删除后 snapshot 来自上一 render（不从 store 重新取）。
 * - Reduced Motion：exit duration = 0（近即时移除）。
 *
 * Motion Contract：默认 duration = MOTION_EXIT_MS.panel —— 与 ExitCollapse 的 CSS
 * 退出过渡（--motion-exit-panel）同源一致，勿在调用处另传魔法数字。
 */
export interface RetainedExitItem<T> {
  item: T;
  exiting: boolean;
}

export function useExitPresenceList<T>({
  items,
  getId,
  resetKey,
  duration = MOTION_EXIT_MS.panel,
}: {
  items: T[];
  getId: (item: T) => string;
  resetKey: string;
  duration?: number;
}): RetainedExitItem<T>[] {
  const reducedMotion = useEffectiveReducedMotion();
  const [retained, setRetained] = useState<T[]>([]);
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(new Set());
  const prevItemsRef = useRef<T[]>(items);
  const prevResetKeyRef = useRef(resetKey);
  const exitTimersRef = useRef<number[]>([]);
  const exitDuration = reducedMotion ? 0 : duration;

  // resetKey 变化：输出只含当前 items（不保留旧 snapshot，避免旧筛选行闪现）
  const resetChanged = prevResetKeyRef.current !== resetKey;

  useEffect(() => {
    if (resetChanged) {
      // reset flow：清理 timers + 状态，并让下一轮以新 items 为基线
      exitTimersRef.current.forEach((t) => window.clearTimeout(t));
      exitTimersRef.current = [];
      setRetained([]);
      setExitingIds(new Set());
      prevItemsRef.current = items;
      prevResetKeyRef.current = resetKey;
      return;
    }

    const prev = prevItemsRef.current;
    prevItemsRef.current = items;

    const prevIds = new Set(prev.map(getId));
    const nextIds = new Set(items.map(getId));
    const gone = prev.filter((it) => !nextIds.has(getId(it)));
    if (gone.length === 0) return;

    const goneIds = gone.map(getId);
    setRetained((r) => [...r, ...gone]);
    setExitingIds((s) => {
      const next = new Set(s);
      goneIds.forEach((id) => next.add(id));
      return next;
    });
    const timer = window.setTimeout(() => {
      exitTimersRef.current = exitTimersRef.current.filter((t) => t !== timer);
      setRetained((r) => r.filter((it) => !goneIds.includes(getId(it))));
      setExitingIds((s) => {
        const next = new Set(s);
        goneIds.forEach((id) => next.delete(id));
        return next;
      });
    }, exitDuration);
    exitTimersRef.current.push(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, resetKey, getId, exitDuration]);

  useEffect(
    () => () => {
      exitTimersRef.current.forEach((t) => window.clearTimeout(t));
      exitTimersRef.current = [];
    },
    []
  );

  // resetChanged：直接同步新列表（不保留旧 snapshot）；否则 items + retained(exiting) snapshot
  if (resetChanged) {
    return items.map((item) => ({ item, exiting: false }));
  }
  return [
    ...items.map((item) => ({ item, exiting: false })),
    ...retained.map((item) => ({ item, exiting: true })),
  ];
}
