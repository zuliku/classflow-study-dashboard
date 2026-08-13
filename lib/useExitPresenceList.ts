import { useEffect, useRef, useState } from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";

/**
 * Exit-only 列表保留 helper（Interaction Motion IM4A）：
 * 当 item 从 items 消失（真实数据 mutation：完成/删除导致离开当前视图）时，
 * 保留上一 render 的 snapshot 并标记 exiting，duration 后移出视觉列表。
 *
 * - 只做 exit：新进入的 item 不产生任何 presence（首次渲染列表不播放动画）。
 * - resetKey 改变（切换 View / 筛选 / 搜索 / risk 过滤）→ 直接同步到新列表，不保留退出 snapshot，
 *   避免大面积 Row 同时 collapse/fade。
 * - Store mutation 必须在调用方立即执行；本 helper 只保留短暂视觉 snapshot。
 * - 支持批量（多个 item 同时消失）。删除后 snapshot 来自上一 render（不从 store 重新取）。
 */
export interface RetainedExitItem<T> {
  item: T;
  exiting: boolean;
}

export function useExitPresenceList<T>({
  items,
  getId,
  resetKey,
  duration = 160,
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

  // resetKey 变化（view/filter/search 切换）→ 直接同步，清空 retained snapshot
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey;
    setRetained([]);
    setExitingIds(new Set());
  }

  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;

    if (prevResetKeyRef.current !== resetKey) return;
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
  }, [items, resetKey, getId, duration]);

  useEffect(
    () => () => {
      exitTimersRef.current.forEach((t) => window.clearTimeout(t));
      exitTimersRef.current = [];
    },
    []
  );

  return [
    ...items.map((item) => ({ item, exiting: false })),
    ...retained.map((item) => ({ item, exiting: true })),
  ];
}
