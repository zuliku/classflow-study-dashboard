"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
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
import {
  sanitizeConversation,
  buildAutoTitle,
  filterValidContextRefs,
} from "@/lib/ai/history/sanitize";
import {
  saveConversation,
  getConversation,
  deleteConversationRecord,
  renameConversationRecord,
  clearConversationHistory,
} from "@/lib/ai/history/db";
import { KiroConversationRecord, PersistedContextRef, KiroConversationSummary } from "@/lib/ai/history/types";
import { requestConversationCompact, toCompactMessages } from "@/lib/ai/history/summary";
import { estimateTokens } from "@/lib/ai/contextBudget/estimate";
import { shouldCompact, DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";
import { buildTranscriptText, buildTranscriptMarkdown, copyTextToClipboard, downloadMarkdownFile } from "@/lib/ai/share";
import { useToastStore } from "@/store/useToastStore";

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
  // Conversation History（本地 IndexedDB）
  currentConversationId: string | null;
  conversationTitle: string | null;
  conversationCreatedAt: string | null;
  conversationSummary: KiroConversationSummary | null;
  historyVersion: number;
  loadConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  clearHistory: () => void;
  refreshHistory: () => void;
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
  /** Kiro Planning Proposal Ghost Preview（UI-only，不持久化；刷新即消失） */
  planningPreview: KiroPlanningPreview | null;
  setPlanningPreview: (p: KiroPlanningPreview | null) => void;
}

/** Ghost StudyBlock（ephemeral：不写入 Store / localStorage） */
export interface KiroPlanningPreview {
  /** Proposal Fingerprint（createStudyPlanProposalKey）：标识当前 Ghost 属于哪个 Proposal */
  proposalKey?: string;
  blocks: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    title: string;
    assignmentId?: string;
    courseId?: string;
  }[];
}

/** Runtime：随 Chat 高频变化（主要消费者：Surface / Composer / Conversation） */
interface KiroRuntimeValue {
  chat: ReturnType<typeof useKiroChat>;
  attachments: ReturnType<typeof useKiroAttachments>;
  activeRefs: KiroContextRef[];
  removeContext: (key: string) => void;
  addManualContext: (ref: KiroContextRef) => void;
}

/** Meta：低频（对话元信息 / historyVersion / sidecar / suggestions / hasMessages） */
interface KiroSessionMetaValue {
  currentConversationId: string | null;
  conversationTitle: string | null;
  conversationCreatedAt: string | null;
  conversationSummary: KiroConversationSummary | null;
  historyVersion: number;
  sidecarOpen: boolean;
  suggestionsKind: KiroSuggestionsKind | null;
  suggestionsGen: number;
  lastUserTurnGen: number;
  hasMessages: boolean;
}

/** Actions：稳定 callbacks（transcript 操作点击时才读取 Ref，不订阅 streaming messages） */
interface KiroSessionActionsValue {
  newChat: () => void;
  loadConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  clearHistory: () => void;
  refreshHistory: () => void;
  openSidecar: () => void;
  closeSidecar: () => void;
  expandSidecar: () => void;
  openForAssignment: (id: string) => void;
  openForCourse: (id: string) => void;
  openForGroupProject: (id: string) => void;
  openForWeek: (week: number) => void;
  handoffPrompt: (prompt: string) => void;
  /** 点击时读取当前 transcript（不订阅 messages） */
  copyCurrentTranscript: () => Promise<void>;
  exportCurrentTranscript: () => void;
  getCurrentMessages: () => ReturnType<typeof useKiroChat>["messages"];
}

const KiroRuntimeContext = createContext<KiroRuntimeValue | null>(null);
const KiroSessionMetaContext = createContext<KiroSessionMetaValue | null>(null);
const KiroSessionActionsContext = createContext<KiroSessionActionsValue | null>(null);
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
  // Ghost Preview（Task 4A）：UI-only，不持久化
  const [planningPreview, setPlanningPreview] = useState<KiroPlanningPreview | null>(null);

  // Conversation History（Task 6）：只存本地 IndexedDB；不进入 useAppStore（属 AI Session 数据）
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [conversationCreatedAt, setConversationCreatedAt] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const conversationIdRef = useRef<string | null>(null);
  const conversationTitleRef = useRef<string | null>(null);
  const conversationCreatedAtRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");

  // Conversation Summary（Task 7）：内部 Model Context；不代表当前 ClassFlow 数据
  const [conversationSummary, setConversationSummary] = useState<KiroConversationSummary | null>(null);
  const conversationSummaryRef = useRef<KiroConversationSummary | null>(null);
  const compactingRef = useRef(false);

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
    conversationSummary,
  });

  const aiProvider = useAISettingsStore((s) => s.provider);
  const aiModel = useAISettingsStore((s) => s.model);
  const aiCustom = useAISettingsStore((s) => s.custom);

  // ---- Conversation Persistence（Task 6）：callback 稳定化（Task 13）----
  // 通过 ref 读取最新值：persist / compact / pagehide listener 不随 token 重建
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const manualRefsRef = useRef(manualRefs);
  manualRefsRef.current = manualRefs;
  const entryRefsRef = useRef(entryRefs);
  entryRefsRef.current = entryRefs;
  const providerRef = useRef(aiProvider);
  providerRef.current = aiProvider;
  const modelRef = useRef(aiModel);
  modelRef.current = aiModel;
  const customRef = useRef(aiCustom);
  customRef.current = aiCustom;
  const chatMessagesRef = useRef<ReturnType<typeof useKiroChat>["messages"]>([]);
  chatMessagesRef.current = chat.messages;

  const refreshHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  /** 保存当前会话到 IndexedDB（稳定点调用；streaming 中不保存半成品） */
  const persistCurrent = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return; // 尚无会话（transient，直到第一条 User Message）
    const chatNow = chatRef.current;
    const messages = chatNow.messages;
    if (messages.length === 0 || chatNow.streaming) return;
    const snapshot = `${id}|${messages.length}|${messages[messages.length - 1]?.content.length ?? 0}|${chatNow.status}`;
    if (snapshot === lastSavedSnapshotRef.current) return; // 无变化不重复写
    lastSavedSnapshotRef.current = snapshot;
    try {
      const record = sanitizeConversation({
        id,
        title: conversationTitleRef.current ?? "Kiro 对话",
        createdAt: conversationCreatedAtRef.current ?? new Date().toISOString(),
        provider: providerRef.current,
        model: modelRef.current,
        messages: messages as ReturnType<typeof useKiroChat>["messages"],
        manualRefs: manualRefsRef.current,
        entryRefs: entryRefsRef.current,
        summary: conversationSummaryRef.current,
      });
      await saveConversation(record);
      refreshHistory();
    } catch (err) {
      console.warn("kiro history: save failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = useCallback(() => {
    // 稳定点（turn 结束 / tool loop 完成）立即保存；防抖仅合并 streaming 状态抖动
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistCurrent();
    }, 300);
  }, [persistCurrent]);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistCurrent();
  }, [persistCurrent]);

  /** 后台 Compact（Task 7）：估算达到预算 75% 时，增量生成 Conversation Summary；失败静默（不阻塞聊天） */
  const maybeCompact = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id || compactingRef.current) return;
    const chatNow = chatRef.current;
    const msgs = chatNow.messages;
    if (msgs.length === 0 || chatNow.streaming) return;
    let est = 0;
    for (const m of msgs) {
      est += estimateTokens(m.content);
      if (m.actions) est += estimateTokens(JSON.stringify(m.actions).slice(0, 4000));
      if (m.historyActions) est += estimateTokens(JSON.stringify(m.historyActions).slice(0, 4000));
    }
    if (!shouldCompact(est, DEFAULT_CONTEXT_BUDGET)) return;

    const through = conversationSummaryRef.current?.throughMessageId;
    const idx = through ? msgs.findIndex((m) => m.id === through) : -1;
    const newMsgs = idx === -1 ? msgs : msgs.slice(idx + 1);
    const textViews = newMsgs
      .map((m) => ({ id: m.id, role: m.role, content: m.content }))
      .filter((m) => m.content.length > 0);
    if (textViews.length === 0) return;

    compactingRef.current = true;
    const summary = await requestConversationCompact({
      provider: providerRef.current,
      model: modelRef.current,
      customConfig: customRef.current,
      oldSummary: conversationSummaryRef.current,
      messages: toCompactMessages(textViews),
    });
    compactingRef.current = false;
    if (summary) {
      conversationSummaryRef.current = summary;
      setConversationSummary(summary);
      scheduleSave(); // 把 summary 一起落盘
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave]);

  // Turn 结束（streaming true→false）→ 保存稳定点 + 判断是否需要 compact；tool loop 完成同样落在这里
  const wasStreamingRef = useRef(false);
  React.useEffect(() => {
    if (chat.streaming) {
      wasStreamingRef.current = true;
      return;
    }
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;
    scheduleSave();
    void maybeCompact();
  }, [chat.streaming, scheduleSave, maybeCompact]);

  // 卸载 / 页面隐藏前 flush（防丢最后状态）
  React.useEffect(() => {
    const onPageHide = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void persistCurrent();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [persistCurrent]);

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
    void flushSave();
    chat.newChat();
    conversationIdRef.current = null;
    conversationTitleRef.current = null;
    conversationCreatedAtRef.current = null;
    conversationSummaryRef.current = null;
    setConversationId(null);
    setConversationTitle(null);
    setConversationCreatedAt(null);
    setConversationSummary(null);
    setManualRefs([]);
    setEntryRefs([]);
    setSuppressedAutoKeys([]);
    attachments.clear();
    setLastUserTurnGen(suggestionsGenRef.current);
    refreshHistory();
  }, [chat.newChat, attachments, flushSave, refreshHistory]);

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
    [chat.send]
  );

  const sendWithTurn = useCallback(
    async (text: string): Promise<boolean> => {
      // 第一次真实 User Message：创建会话（transient → 正式写 DB 在首个稳定点）
      if (!conversationIdRef.current) {
        const id = globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `conv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        const title = buildAutoTitle(text);
        const createdAt = new Date().toISOString();
        conversationIdRef.current = id;
        conversationTitleRef.current = title;
        conversationCreatedAtRef.current = createdAt;
        setConversationId(id);
        setConversationTitle(title);
        setConversationCreatedAt(createdAt);
      }
      setLastUserTurnGen(suggestionsGenRef.current);
      // 扫描 PDF 渲染失败时返回 false：不清空附件、不清空 Composer（Prompt 保留）
      const ok = await chat.send(text);
      if (ok) attachments.clear();
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.send, attachments]
  );

  /** 恢复历史对话：先保存当前 → 加载目标 → 恢复 refs（校验实体仍存在）→ 关闭由 Panel 处理 */
  const loadConversation = useCallback(
    async (id: string) => {
      const target = await getConversation(id);
      if (!target) {
        refreshHistory();
        return;
      }
      await flushSave();
      const state = useAppStore.getState();
      const restoreRefs = (refs: PersistedContextRef[], source: "manual" | "entry"): KiroContextRef[] =>
        filterValidContextRefs(refs, state).map((r) => ({
          key: `restored-${source}-${r.kind}-${r.entityId ?? "?"}`,
          kind: r.kind,
          entityId: r.entityId,
          label: r.label,
          source,
        }));
      chat.loadConversation(target);
      conversationIdRef.current = target.id;
      conversationTitleRef.current = target.title;
      conversationCreatedAtRef.current = target.createdAt;
      conversationSummaryRef.current = target.summary ?? null;
      setConversationId(target.id);
      setConversationTitle(target.title);
      setConversationCreatedAt(target.createdAt);
      setConversationSummary(target.summary ?? null);
      setManualRefs(restoreRefs(target.manualRefs, "manual"));
      setEntryRefs(restoreRefs(target.entryRefs, "entry"));
      setSuppressedAutoKeys([]);
      setSuggestionsKind(null);
      setLastUserTurnGen(suggestionsGenRef.current);
      attachments.clear();
    },
    [chat.loadConversation, attachments, flushSave, refreshHistory]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await deleteConversationRecord(id);
      if (conversationIdRef.current === id) {
        // 删除当前会话：切到新的 transient session，避免 UI 指向不存在的 ID
        newChat();
      }
      refreshHistory();
    },
    [newChat, refreshHistory]
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const t = title.trim();
      if (!t) return;
      await renameConversationRecord(id, t);
      if (conversationIdRef.current === id) {
        conversationTitleRef.current = t;
        setConversationTitle(t);
      }
      refreshHistory();
    },
    [refreshHistory]
  );

  const clearHistory = useCallback(() => {
    void clearConversationHistory();
    newChat();
  }, [newChat]);

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

  // ---- Transcript 操作（Task 13）：点击时读 Ref，collapsed Rail 不订阅 streaming messages ----
  const pushToast = useToastStore((s) => s.pushToast);

  const copyCurrentTranscript = useCallback(async () => {
    const ok = await copyTextToClipboard(buildTranscriptText(chatMessagesRef.current));
    if (ok) pushToast({ message: "已复制" });
  }, [pushToast]);

  const exportCurrentTranscript = useCallback(() => {
    downloadMarkdownFile("kiro-conversation.md", buildTranscriptMarkdown(chatMessagesRef.current));
    pushToast({ message: "已导出 Markdown" });
  }, [pushToast]);

  const getCurrentMessages = useCallback(() => chatMessagesRef.current, []);

  const runtimeValue = useMemo<KiroRuntimeValue>(
    () => ({ chat, attachments, activeRefs, removeContext, addManualContext }),
    [chat, attachments, activeRefs, removeContext, addManualContext]
  );

  // hasMessages：低频（只在 empty ↔ non-empty 切换时更新，不随 token）
  const [hasMessages, setHasMessages] = useState(false);
  const hasMessagesNow = chat.messages.length > 0;
  React.useEffect(() => {
    setHasMessages(hasMessagesNow);
  }, [hasMessagesNow]);

  const metaValue = useMemo<KiroSessionMetaValue>(
    () => ({
      currentConversationId: conversationId,
      conversationTitle,
      conversationCreatedAt,
      conversationSummary,
      historyVersion,
      sidecarOpen,
      suggestionsKind,
      suggestionsGen: suggestionsGenRef.current,
      lastUserTurnGen,
      hasMessages,
    }),
    [
      conversationId,
      conversationTitle,
      conversationCreatedAt,
      conversationSummary,
      historyVersion,
      sidecarOpen,
      suggestionsKind,
      lastUserTurnGen,
      hasMessages,
    ]
  );

  const actionsValue = useMemo<KiroSessionActionsValue>(
    () => ({
      newChat,
      loadConversation,
      deleteConversation,
      renameConversation,
      clearHistory,
      refreshHistory,
      openSidecar,
      closeSidecar,
      expandSidecar,
      openForAssignment,
      openForCourse,
      openForGroupProject,
      openForWeek,
      handoffPrompt,
      copyCurrentTranscript,
      exportCurrentTranscript,
      getCurrentMessages,
    }),
    [
      newChat,
      loadConversation,
      deleteConversation,
      renameConversation,
      clearHistory,
      refreshHistory,
      openSidecar,
      closeSidecar,
      expandSidecar,
      openForAssignment,
      openForCourse,
      openForGroupProject,
      openForWeek,
      handoffPrompt,
      copyCurrentTranscript,
      exportCurrentTranscript,
      getCurrentMessages,
    ]
  );

  // 兼容层：旧 useKiroSession() 消费者（低频组件）合并三个 Context
  const value: KiroSessionValue = {
    chat,
    attachments,
    activeRefs,
    removeContext,
    addManualContext,
    newChat,
    currentConversationId: conversationId,
    conversationTitle,
    conversationCreatedAt,
    conversationSummary,
    historyVersion,
    loadConversation,
    deleteConversation,
    renameConversation,
    clearHistory,
    refreshHistory,
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
    planningPreview,
    setPlanningPreview,
  };

  // 把 send 换成带回合标记的版本（surface 使用）
  const sessionValue = useMemo(
    () => ({ ...value, chat: { ...value.chat, send: sendWithTurn } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, sendWithTurn]
  );

  return (
    <KiroRuntimeContext.Provider value={runtimeValue}>
      <KiroSessionMetaContext.Provider value={metaValue}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          <KiroSessionContext.Provider value={sessionValue}>
            {/* 固定视口高度外壳（h-dvh）：main 内部滚动，Kiro Conversation 独立滚动，不随内容撑高 */}
            <div className="flex h-dvh bg-[#F7F5F5] font-sans antialiased text-charcoal">
              {children}
              {/* Sidecar 与 Workspace 互斥：进入 Kiro Workspace 时不渲染 Sidecar（Session 保留） */}
              {sidecarOpen && activeTab !== "kiro" && <KiroSidecar />}
            </div>
          </KiroSessionContext.Provider>
        </KiroSessionActionsContext.Provider>
      </KiroSessionMetaContext.Provider>
    </KiroRuntimeContext.Provider>
  );
}

export function useKiroRuntime(): KiroRuntimeValue {
  const ctx = useContext(KiroRuntimeContext);
  if (!ctx) throw new Error("useKiroRuntime 必须在 KiroSessionProvider 内使用");
  return ctx;
}

export function useKiroSessionMeta(): KiroSessionMetaValue {
  const ctx = useContext(KiroSessionMetaContext);
  if (!ctx) throw new Error("useKiroSessionMeta 必须在 KiroSessionProvider 内使用");
  return ctx;
}

export function useKiroSessionActions(): KiroSessionActionsValue {
  const ctx = useContext(KiroSessionActionsContext);
  if (!ctx) throw new Error("useKiroSessionActions 必须在 KiroSessionProvider 内使用");
  return ctx;
}

export function useKiroSession(): KiroSessionValue {
  const ctx = useContext(KiroSessionContext);
  if (!ctx) throw new Error("useKiroSession 必须在 KiroSessionProvider 内使用");
  return ctx;
}

export { KiroSessionContext };
