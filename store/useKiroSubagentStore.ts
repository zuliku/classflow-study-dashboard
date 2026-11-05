"use client";

import { create } from "zustand";
import type { KiroSubagentRole } from "@/lib/ai/agent/subagent";

/**
 * Kiro Subagent runtime store（ephemeral，不持久化）：
 * - 右侧 Inspector / 内联卡片订阅；每个 run 按 toolCallId 精确关联主对话 tool part；
 * - text 来自子代理 SSE 的 text-delta（实时）；steps 来自工具事件；
 * - 不进入主 Conversation messages / 历史 / Citation registry。
 */

export type KiroSubagentStatus = "running" | "completed" | "failed" | "cancelled";
export type KiroSubagentStepStatus = "working" | "done" | "error";

export interface KiroSubagentStep {
  id: string;
  toolName: string;
  label: string;
  status: KiroSubagentStepStatus;
  /** 安全摘要（query/topic/来源数量；不含 raw JSON / URL 列表） */
  detail?: string;
}

export interface KiroSubagentRun {
  id: string;
  conversationId: string | null;
  role: KiroSubagentRole;
  task: string;
  status: KiroSubagentStatus;
  text: string;
  steps: KiroSubagentStep[];
  webUsed: boolean;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const MAX_RUNS = 24;
const MAX_TEXT_CHARS = 24_000;

interface StartInput {
  id: string;
  conversationId: string | null;
  role: KiroSubagentRole;
  task: string;
  webUsed: boolean;
}

interface KiroSubagentStore {
  runs: Record<string, KiroSubagentRun>;
  order: string[];
  start: (input: StartInput) => void;
  appendText: (id: string, delta: string) => void;
  upsertStep: (id: string, step: KiroSubagentStep) => void;
  complete: (id: string, summary?: string, webUsed?: boolean) => void;
  fail: (id: string, message: string) => void;
  cancel: (id: string) => void;
  cancelRunning: (conversationId?: string | null) => void;
  reset: () => void;
}

function trimRuns(runs: Record<string, KiroSubagentRun>, order: string[]): string[] {
  if (order.length <= MAX_RUNS) return order;
  // 先移除最旧的已完成/失败/取消，保留 running
  const next = [...order];
  for (let i = 0; i < next.length && next.length > MAX_RUNS; i++) {
    const run = runs[next[i]];
    if (run && run.status === "running") continue;
    next.splice(i, 1);
    i -= 1;
  }
  return next.slice(-MAX_RUNS);
}

export const useKiroSubagentStore = create<KiroSubagentStore>()((set) => ({
  runs: {},
  order: [],

  start: (input) =>
    set((state) => {
      const run: KiroSubagentRun = {
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        task: input.task,
        status: "running",
        text: "",
        steps: [],
        webUsed: input.webUsed,
        startedAt: Date.now(),
      };
      const order = state.order.includes(input.id)
        ? state.order
        : [...state.order, input.id];
      const runs = { ...state.runs, [input.id]: run };
      return { runs, order: trimRuns(runs, order) };
    }),

  appendText: (id, delta) =>
    set((state) => {
      const run = state.runs[id];
      if (!run || !delta) return state;
      const text = (run.text + delta).slice(0, MAX_TEXT_CHARS);
      return { runs: { ...state.runs, [id]: { ...run, text } } };
    }),

  upsertStep: (id, step) =>
    set((state) => {
      const run = state.runs[id];
      if (!run) return state;
      const index = run.steps.findIndex((s) => s.id === step.id);
      const steps =
        index >= 0
          ? run.steps.map((s) => (s.id === step.id ? { ...s, ...step } : s))
          : [...run.steps, step].slice(-8);
      return { runs: { ...state.runs, [id]: { ...run, steps } } };
    }),

  complete: (id, summary, webUsed) =>
    set((state) => {
      const run = state.runs[id];
      if (!run) return state;
      return {
        runs: {
          ...state.runs,
          [id]: {
            ...run,
            status: "completed",
            text: summary ? summary.slice(0, MAX_TEXT_CHARS) : run.text,
            webUsed: webUsed ?? run.webUsed,
            completedAt: Date.now(),
            error: undefined,
          },
        },
      };
    }),

  fail: (id, message) =>
    set((state) => {
      const run = state.runs[id];
      if (!run) return state;
      return {
        runs: {
          ...state.runs,
          [id]: {
            ...run,
            status: "failed",
            error: message.slice(0, 400),
            completedAt: Date.now(),
          },
        },
      };
    }),

  cancel: (id) =>
    set((state) => {
      const run = state.runs[id];
      if (!run) return state;
      return {
        runs: {
          ...state.runs,
          [id]: { ...run, status: "cancelled", completedAt: Date.now() },
        },
      };
    }),

  cancelRunning: (conversationId) =>
    set((state) => {
      let changed = false;
      const runs = { ...state.runs };
      for (const id of state.order) {
        const run = runs[id];
        if (!run || run.status !== "running") continue;
        if (conversationId !== undefined && run.conversationId !== conversationId) continue;
        runs[id] = { ...run, status: "cancelled", completedAt: Date.now() };
        changed = true;
      }
      return changed ? { runs } : state;
    }),

  reset: () => set({ runs: {}, order: [] }),
}));
