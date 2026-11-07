/**
 * Plan 画布布局：同一垂直时间轴上的重叠实体分栏。
 * 纯函数，无 React / Store 依赖。
 */

export interface PlanLayoutItem {
  id: string;
  start: number;
  end: number;
}

export interface PlanLayoutSlot {
  lane: number;
  lanes: number;
}

export function layoutPlanItems(items: readonly PlanLayoutItem[]): Map<string, PlanLayoutSlot> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: PlanLayoutItem[][] = [];

  for (const item of sorted) {
    const cluster = clusters.find((group) => item.start < Math.max(...group.map((x) => x.end)));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }

  const layout = new Map<string, PlanLayoutSlot>();
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assigned: { id: string; lane: number }[] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      assigned.push({ id: item.id, lane });
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const item of assigned) layout.set(item.id, { lane: item.lane, lanes });
  }
  return layout;
}

export function minutesToPlanTime(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function planTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function planDurationMinutes(start: string, end: string): number {
  const s = planTimeToMinutes(start);
  const e = planTimeToMinutes(end);
  if (s === null || e === null || e <= s) return 0;
  return e - s;
}
