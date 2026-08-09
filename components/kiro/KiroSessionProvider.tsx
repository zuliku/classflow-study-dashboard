"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useKiroChat } from "@/hooks/useKiroChat";
import { useKiroAttachments } from "@/hooks/useKiroAttachments";
import {
  buildAutoContextRefs,
  resolveContextRefs,
  replaceEntryRefs,
  dedupeContextRefs,
} from "@/lib/ai/context/contextSelection";
import {
  assignmentEntryRef,
  courseEntryRef,
  groupProjectEntryRef,
  weekEntryRef,
  suggestionsTypeOf,
} from "@/lib/ai/context/handoff";
import { KiroContextRef } from "@/lib/ai/context/types";
import { KiroSidecar } from "@/components/kiro/KiroSidecar";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

export type KiroSuggestionsKind = "assignment" | "course" | "group-project" | "week" | "generic";

interface KiroSessionValue {
  // Chat runtime（唯一）
  chat: ReturnType<typeof useKiroChat>;
  attachments: ReturnType<typeof useKiroAttachments>;
  // Context
  activeRefs: KiroContextRef[];
  removeContext: (key: string) => void;
  addManualContext: (ref: KiroContextRef) => void;
  newChat: () => void;
  // Sidecar
  sidecarOpen: boolean;
  openSidecar: () => void;
  closeSidecar: () => void;
  expandSidecar: () => void;
  suggestionsKind: KiroSuggestionsKind | null;
  suggestionsGen: number;
  lastUserTurnGen: number;
  // Handoff（业务 UI 只调这些）
  openForAssignment: (id: string) => void;
  openForCourse: (id: string) => void;
  openForGroupProject: (id: string) => void;
  openForWeek: (week: number) => void;
  handoffPrompt: (prompt: string) => void;
}

const KiroSessionContext = createContext<KiroSessionValue | null>(null);

/**
 * Persistent Kiro Session Provider（长期挂载，不随 activeTab 卸载）。
 * 集中持有唯一 Chat Runtime / Attachments / Context / Sidecar 状态。
 * KiroWorkspace 与 KiroSidecar 通过 useKiroSession() 共享同一会话。
 */
export function KiroSessionProvider({ children }: { children: React.ReactNode }) {
  const [manualRefs, setManualRefs] = useState<KiroContextRef[]>([]);
  const [entryRefs, setEntryRefs] = useState<KiroContextRef[]>([]);
  const [suppressedAutoKeys, setSuppressedAutoKeys] = useState<string[]>([]);
  const [sidecarOpen, setSidecarOpen] = useState(false);
  const [suggestionsKind, setSuggestionsKind] = useState<KiroSuggestionsKind | null>(null);
  const suggestionsGenRef = useRef(0);
  const [lastUserTurnGen, setLastUserTurnGen] = useState(0);

  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const activeTab = useAppStore((s) => s.activeTab);

  // Auto Context：reactive（Zustand selector 订阅 + useMemo，非偶然 rerender）
  const autoState = useAppStore(
    useShallow((s) => ({
      selectedCourseId: s.selectedCourseId,
      selectedAssignmentId: s.selectedAssignmentId,
      highlightedAssignmentId: s.highlightedAssignmentId,
      currentSemesterWeek: s.currentSemesterWeek,
      semester: s.semester,
      assignments: s.assignments,
      courses: s.courses,
    }))
  );
  const autoRefs = useMemo(() => buildAutoContextRefs(autoState), [autoState]);

  const attachments = useKiroAttachments();
  const chat = useKiroChat({
    autoRefs,
    manualRefs,
    entryRefs,
    suppressedAutoKeys,
    attachments: attachments.attachments,
  });

  const activeRefs = useMemo(
    () =>
      dedupeContextRefs(
        resolveContextRefs(autoRefs, manualRefs, entryRefs, suppressedAutoKeys),
        autoState.currentSemesterWeek
      ),
    [autoRefs, manualRefs, entryRefs, suppressedAutoKeys, autoState.currentSemesterWeek]
  );

  const removeContext = useCallback(
    (key: string) => {
      const isAuto = autoRefs.some((r) => r.key === key) || entryRefs.some((r) => r.key === key);
      if (isAuto) {
        setSuppressedAutoKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      } else {
        setManualRefs((prev) => prev.filter((r) => r.key !== key));
      }
    },
    [autoRefs, entryRefs]
  );

  const addManualContext = useCallback((ref: KiroContextRef) => {
    setManualRefs((prev) => (prev.some((r) => r.key === ref.key) ? prev : [...prev, ref]));
  }, []);

  const newChat = useCallback(() => {
    chat.newChat();
    setManualRefs([]);
    setEntryRefs([]);
    setSuppressedAutoKeys([]);
    attachments.clear();
    setLastUserTurnGen(suggestionsGenRef.current);
  }, [chat, attachments]);

  const openSidecar = useCallback(() => {
    setSidecarOpen(true);
  }, []);

  const closeSidecar = useCallback(() => {
    setSidecarOpen(false);
  }, []);

  const expandSidecar = useCallback(() => {
    setSidecarOpen(false);
    setActiveTab("kiro");
  }, [setActiveTab]);

  /** 从业务实体打开 Sidecar：Entry Context 替换（不累积），显式展示可移除 */
  const openForEntry = useCallback((refs: KiroContextRef[], kind: KiroSuggestionsKind) => {
    setEntryRefs((prev) => replaceEntryRefs(prev, refs));
    suggestionsGenRef.current += 1;
    setSuggestionsKind(kind);
    setSidecarOpen(true);
  }, []);

  const openForAssignment = useCallback(
    (id: string) => {
      const ref = assignmentEntryRef(useAppStore.getState(), id);
      if (ref) openForEntry([ref], suggestionsTypeOf(ref));
    },
    [openForEntry]
  );
  const openForCourse = useCallback(
    (id: string) => {
      const ref = courseEntryRef(useAppStore.getState(), id);
      if (ref) openForEntry([ref], suggestionsTypeOf(ref));
    },
    [openForEntry]
  );
  const openForGroupProject = useCallback(
    (id: string) => {
      const ref = groupProjectEntryRef(useAppStore.getState(), id);
      if (ref) openForEntry([ref], suggestionsTypeOf(ref));
    },
    [openForEntry]
  );
  const openForWeek = useCallback(
    (week: number) => {
      openForEntry([weekEntryRef(week)], "week");
    },
    [openForEntry]
  );

  const handoffPrompt = useCallback(
    (prompt: string) => {
      suggestionsGenRef.current += 1;
      setSuggestionsKind("generic");
      setSidecarOpen(true);
      setLastUserTurnGen(suggestionsGenRef.current);
      chat.send(prompt);
    },
    [chat]
  );

  const sendWithTurn = useCallback(
    (text: string) => {
      setLastUserTurnGen(suggestionsGenRef.current);
      chat.send(text);
      attachments.clear();
    },
    [chat, attachments]
  );

  // Sidecar 打开时注册 overlay（Esc 只在最上层关闭）
  React.useEffect(() => {
    if (!sidecarOpen) return;
    pushOverlay("kiro-sidecar", 45);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay("kiro-sidecar")) setSidecarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay("kiro-sidecar");
      window.removeEventListener("keydown", onKey);
    };
  }, [sidecarOpen]);

  const value: KiroSessionValue = {
    chat,
    attachments,
    activeRefs,
    removeContext,
    addManualContext,
    newChat,
    sidecarOpen,
    openSidecar,
    closeSidecar,
    expandSidecar,
    suggestionsKind,
    suggestionsGen: suggestionsGenRef.current,
    lastUserTurnGen,
    openForAssignment,
    openForCourse,
    openForGroupProject,
    openForWeek,
    handoffPrompt,
  };

  // 把 send 换成带回合标记的版本（surface 使用）
  const sessionValue = useMemo(
    () => ({ ...value, chat: { ...value.chat, send: sendWithTurn } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, sendWithTurn]
  );

  return (
    <KiroSessionContext.Provider value={sessionValue}>
      {/* 固定视口高度外壳（h-dvh）：main 内部滚动，Kiro Conversation 独立滚动，不随内容撑高 */}
      <div className="flex h-dvh bg-[#F7F5F5] font-sans antialiased text-charcoal">
        {children}
        {/* Sidecar 与 Workspace 互斥：进入 Kiro Workspace 时不渲染 Sidecar（Session 保留） */}
        {sidecarOpen && activeTab !== "kiro" && <KiroSidecar />}
      </div>
    </KiroSessionContext.Provider>
  );
}

export function useKiroSession(): KiroSessionValue {
  const ctx = useContext(KiroSessionContext);
  if (!ctx) throw new Error("useKiroSession 必须在 KiroSessionProvider 内使用");
  return ctx;
}

export { KiroSessionContext };
