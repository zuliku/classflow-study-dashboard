"use client";

import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import {
  countLearningHistoryEvents,
  getLearningHistoryCoverage,
} from "@/lib/history/store";
import { clearLearningHistoryForUser } from "@/lib/history/clear";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { LearningHistoryCoverage } from "@/lib/history/types";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** 学习历史管理（Part 2）：metadata（startedAt/count）+ 清除；不做 Event Viewer */
export function LearningHistorySettings() {
  const [coverage, setCoverage] = useState<LearningHistoryCoverage | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  const refresh = async () => {
    setLoadFailed(false);
    try {
      const [c, n] = await Promise.all([
        getLearningHistoryCoverage(),
        countLearningHistoryEvents(),
      ]);
      setCoverage(c);
      setCount(n);
    } catch {
      // History best effort：失败不闪 0，露出可重试的错误态
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleClear = () => {
    confirmRequest({
      title: "清除学习历史？",
      description:
        "这会删除任务变化、专注、学习计划和课表变化的历史记录。当前课程、任务、课表和 Focus Session 不会被删除。清除后，历史趋势将从现在重新开始。",
      confirmLabel: "清除历史",
      danger: true,
      onConfirm: () => {
        setClearing(true);
        clearLearningHistoryForUser();
        void flushLearningHistoryQueue()
          .then(async () => {
            await refresh();
          })
          .catch(() => {
            pushToast({ message: "清除失败，请重试。", type: "error" });
          })
          .finally(() => {
            setClearing(false);
          });
      },
    });
  };

  return (
    <SettingsActionRow
      title="学习历史"
      description={
        loading
          ? "加载中…"
          : loadFailed
            ? "历史记录加载失败，请重试。"
            : count === null
              ? "用于学习洞察（工作区与 Kiro）。"
              : count === 0
                ? "0 条历史事件 · 从今天起重新记录"
                : `${formatDate(coverage?.historyStartedAt ?? Date.now())} 起记录 · ${count.toLocaleString()} 条历史事件 · 用于学习洞察（工作区与 Kiro）。`
      }
      icon={<History className="w-3.5 h-3.5 text-[#A48F82]" />}
      actionLabel={clearing ? "清除中…" : loadFailed ? "重新加载" : "清除学习历史"}
      variant="secondary"
      onAction={loadFailed && !clearing ? () => void refresh() : handleClear}
      actionTestid="clear-learning-history"
    />
  );
}
