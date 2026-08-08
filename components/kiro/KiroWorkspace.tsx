"use client";

import React, { useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroEmptyState } from "@/components/kiro/KiroEmptyState";
import { KiroConversation, KiroChatMessage } from "@/components/kiro/KiroConversation";
import { KiroComposer } from "@/components/kiro/KiroComposer";
import { KiroContextChip } from "@/components/kiro/KiroContextBar";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";

let msgSeq = 0;
const nextId = () => `kmsg_${++msgSeq}`;

/**
 * Kiro Workspace：ClassFlow 的自然语言工作区（一级 Tab，非 Modal/Drawer）。
 * Task 0 为纯 UI：消息为本地 preview，不调用 AI、不改动任何 ClassFlow 数据。
 * 组件边界保持独立（Header / EmptyState / Conversation / Composer / Context / History），
 * 未来 Provider / Agent Runtime / Sidecar 直接复用。
 */
export function KiroWorkspace() {
  const [messages, setMessages] = useState<KiroChatMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manualContexts, setManualContexts] = useState<KiroContextChip[]>([]);

  // 自动 Context：来自当前选中实体（Store 只读，属于 UI 展示）
  const selectedAssignmentId = useAppStore((s) => s.selectedAssignmentId);
  const selectedCourseId = useAppStore((s) => s.selectedCourseId);
  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);

  const autoContexts = useMemo(() => {
    const chips: KiroContextChip[] = [];
    const task = assignments.find((a) => a.id === selectedAssignmentId);
    if (task) chips.push({ id: `auto-task-${task.id}`, kind: "assignment", label: `当前任务 · ${task.title}` });
    const course = courses.find((c) => c.id === selectedCourseId);
    if (course) chips.push({ id: `auto-course-${course.id}`, kind: "course", label: `当前课程 · ${course.name}` });
    return chips;
  }, [selectedAssignmentId, selectedCourseId, assignments, courses]);

  const contexts = [...autoContexts, ...manualContexts];

  const addManualContext = (chip: KiroContextChip) => {
    setManualContexts((prev) => (prev.some((c) => c.id === chip.id) ? prev : [...prev, chip]));
  };
  const removeContext = (id: string) => {
    setManualContexts((prev) => prev.filter((c) => c.id !== id));
  };

  /** 发送本地 preview message（不产生任何真实效果） */
  const send = (text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: text },
      {
        id: nextId(),
        role: "kiro",
        content: "Kiro 服务将在下一阶段接入。当前为界面预览，这只是一个本地占位回复，不会执行任何真实操作。",
      },
    ]);
  };

  const newChat = () => {
    setMessages([]);
    setManualContexts([]);
  };

  return (
    <div
      data-testid="kiro-workspace"
      className="h-[calc(100dvh-170px)] md:h-[calc(100dvh-96px)] flex flex-col"
    >
      <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />

      <div className="relative flex-1 min-h-0 flex flex-col">
        {messages.length === 0 ? (
          <KiroEmptyState onSuggestion={send} />
        ) : (
          <KiroConversation messages={messages} />
        )}

        <KiroComposer
          contexts={contexts}
          onAddContext={addManualContext}
          onRemoveContext={removeContext}
          onSend={send}
        />

        {historyOpen && (
          <KiroHistoryPanel onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
        )}
      </div>
    </div>
  );
}
