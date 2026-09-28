import { create } from "zustand";
import { DesktopTerminalEvent } from "@/lib/desktop/types";
import {
  TerminalActivity,
  TerminalActivityInit,
  applyTerminalEvent,
  createTerminalActivity,
  isTerminalActivityTerminal,
} from "@/lib/ai/computer/terminal/activity";

/**
 * Runtime Terminal Activity Store（UI-only；不持久化，不进入模型 context）。
 * - 事件 batching：pending 队列按 animation frame flush（高速 stdout 不逐 chunk setState）。
 * - ring buffer 已由 activity reducer 限制（行/字符有界）。
 * - activities 以稳定数组暴露（渲染顺序 = 注册顺序）；version 单调递增供 memo 消费。
 */
interface TerminalActivityStoreState {
  activities: TerminalActivity[];
  version: number;
  registerActivity: (init: TerminalActivityInit) => void;
  pushEvent: (event: DesktopTerminalEvent) => void;
  setWaitingInput: (executionId: string, waiting: boolean) => void;
  clearAll: () => void;
}

const TERMINAL_ACTIVITY_MAX_ACTIVE = 12;
/**
 * S-fix 长会话内存：已终态 activity 上限（行/字符已有 reducer 有界，此处限条数）。
 * 只丢弃最旧的已终态项，运行中项永不丢弃；阈值宽松（百级），常规会话无感知。
 */
const TERMINAL_ACTIVITY_MAX_RETAINED = 100;

/** 丢弃最旧的已终态 activity，直到总量回到上限内（运行中项保留） */
function trimTerminated(activities: TerminalActivity[]): TerminalActivity[] {
  if (activities.length <= TERMINAL_ACTIVITY_MAX_RETAINED) return activities;
  const over = activities.length - TERMINAL_ACTIVITY_MAX_RETAINED;
  let dropped = 0;
  return activities.filter((a) => {
    if (dropped >= over) return true;
    if (isTerminalActivityTerminal(a.status)) {
      dropped += 1;
      return false;
    }
    return true;
  });
}

let pendingEvents: DesktopTerminalEvent[] = [];
let flushScheduled = false;
let versionCounter = 0;

function flushPending() {
  const events = pendingEvents;
  pendingEvents = [];
  flushScheduled = false;
  if (events.length === 0) return;
  versionCounter += 1;
  useTerminalActivityStore.setState((state) => {
    let activities = state.activities;
    for (const event of events) {
      const idx = activities.findIndex((a) => a.executionId === event.executionId);
      if (idx === -1) continue; // 孤儿事件（无 activity 记录）：忽略
      const updated = applyTerminalEvent(activities[idx], event);
      if (!updated) continue;
      activities = activities.map((a, i) => (i === idx ? updated : a));
    }
    return { activities, version: versionCounter };
  });
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flushPending());
  } else {
    setTimeout(flushPending, 25);
  }
}

export const useTerminalActivityStore = create<TerminalActivityStoreState>()((set, get) => ({
  activities: [],
  version: 0,
  registerActivity: (init) => {
    const current = get().activities;
    if (current.some((a) => a.executionId === init.executionId)) return;
    versionCounter += 1;
    let next = [...current, createTerminalActivity(init)];
    // 上限保护：活跃（非终态）activity 超限时丢弃最旧的非终态
    const activeCount = next.filter((a) => !isTerminalActivityTerminal(a.status)).length;
    if (activeCount > TERMINAL_ACTIVITY_MAX_ACTIVE) {
      const dropIdx = next.findIndex((a) => !isTerminalActivityTerminal(a.status));
      if (dropIdx !== -1) next = next.filter((_, i) => i !== dropIdx);
    }
    // S-fix：总量上限（已终态 oldest 优先丢弃，运行中永保留）
    next = trimTerminated(next);
    set({ activities: next, version: versionCounter });
  },
  pushEvent: (event) => {
    pendingEvents.push(event);
    scheduleFlush();
  },
  setWaitingInput: (executionId, waiting) => {
    versionCounter += 1;
    const next = get().activities.map((a) =>
      a.executionId === executionId
        ? { ...a, waitingForInput: waiting, status: waiting ? ("waiting-input" as const) : a.status }
        : a
    );
    set({ activities: next, version: versionCounter });
  },
  clearAll: () => {
    pendingEvents = [];
    versionCounter += 1;
    set({ activities: [], version: versionCounter });
  },
}));
