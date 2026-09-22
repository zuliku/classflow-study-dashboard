"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Copy,
  FileDown,
  History as HistoryIcon,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS, MOTION_MS } from "@/lib/motion";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
import { KiroNavigatorPlate } from "@/components/kiro/navigation/KiroNavigatorPlate";
import { KiroNavigatorHome } from "@/components/kiro/navigation/KiroNavigatorHome";
import { KiroNavigatorProjectDetail } from "@/components/kiro/navigation/KiroNavigatorProjectDetail";
import {
  KiroNavigatorProjectForm,
  type KiroNavigatorProjectFormValues,
} from "@/components/kiro/navigation/KiroNavigatorProjectForm";
import { KiroNavigatorAddConversation } from "@/components/kiro/navigation/KiroNavigatorAddConversation";
import { KIRO_PROJECT_ICON } from "@/components/kiro/kiroProjectIcon";
import { listConversations } from "@/lib/ai/history/db";
import { listKiroProjects } from "@/lib/ai/projects/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { KiroProjectRecord } from "@/lib/ai/projects/types";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KIRO_OUTPUT_TEXT_SIZE_LABELS, KiroOutputTextSize } from "@/lib/ai/ui/typography";
import { kiroRuntimeStatusAriaLabel, kiroRuntimeStatusText } from "@/lib/ai/ui/kiroRuntimeStatus";
import { cn } from "@/lib/utils";

/**
 * Kiro Navigator（V1）：统一左侧导航（Thread Rail + Project Panel 收敛）。
 *
 * - Collapsed 52px（产品形态保持）；Expanded 288 / lg 304（overlay；不重排 Chat 宽度）
 * - Home：新对话 / 统一搜索 / 项目（含新建）/ 最近对话（KiroThreadRow）
 * - Project Detail：项目内对话 + 项目资料 + 项目指令 + 编辑 / 删除 + 项目内新对话 + 添加历史
 * - Runtime Status 继续消费 meta.kiroRuntimeStatus（不重新推导；expanded/collapsed 不影响状态）
 * - 数据全部来自 Session actions + IndexedDB（lazy：collapsed 不读 DB；Detail 才读项目资料）
 */
export type NavigatorView =
  | { type: "home" }
  | { type: "project"; projectId: string }
  | { type: "project-create" }
  | { type: "project-edit"; projectId: string }
  | { type: "add-conversation"; projectId: string };

function viewKeyOf(view: NavigatorView): string {
  switch (view.type) {
    case "home":
      return "home";
    case "project":
      return `project:${view.projectId}`;
    case "project-create":
      return "project-create";
    case "project-edit":
      return `project-edit:${view.projectId}`;
    case "add-conversation":
      return `add-conversation:${view.projectId}`;
  }
}

export function KiroNavigator() {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const outputTextSize = useKiroPreferencesStore((s) => s.outputTextSize);
  const setOutputTextSize = useKiroPreferencesStore((s) => s.setOutputTextSize);

  const runtimeStatus = meta.kiroRuntimeStatus;
  const runtimeStatusText = kiroRuntimeStatusText(runtimeStatus);
  const runtimeStatusAria = kiroRuntimeStatusAriaLabel(runtimeStatus);

  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<NavigatorView>({ type: "home" });
  const [query, setQuery] = useState("");
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [projects, setProjects] = useState<KiroProjectRecord[]>([]);
  const [threads, setThreads] = useState<KiroConversationRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<NavigatorView>(view);
  viewRef.current = view;
  const viewShiftRef = useRef<"next" | "prev">("next");

  // Motion V1：collapsed / expanded 两层 presence（同一 persistent shell 做 width morph）
  const collapsedPresence = usePresence(!expanded, MOTION_EXIT_MS.panel);
  const expandedPresence = usePresence(expanded, MOTION_MS.overlay);

  const goToView = useCallback((next: NavigatorView) => {
    const prev = viewRef.current;
    if (viewKeyOf(prev) === viewKeyOf(next)) return;
    viewShiftRef.current = next.type === "home" ? "prev" : prev.type === "home" ? "next" : "next";
    viewRef.current = next;
    setView(next);
  }, []);

  // ---- Lazy load：collapsed 不读 DB；首次 expanded 并行读取 History + Projects；版本变化刷新 ----
  const loadedProjectsVersionRef = useRef(-1);
  const loadedHistoryVersionRef = useRef(-1);
  useEffect(() => {
    if (!expanded) return;
    const needProjects = loadedProjectsVersionRef.current !== meta.projectsVersion;
    const needThreads = loadedHistoryVersionRef.current !== meta.historyVersion;
    if (!needProjects && !needThreads) return;
    loadedProjectsVersionRef.current = meta.projectsVersion;
    loadedHistoryVersionRef.current = meta.historyVersion;
    let cancelled = false;
    void Promise.all([
      needProjects ? listKiroProjects() : Promise.resolve(null),
      needThreads ? listConversations() : Promise.resolve(null),
    ])
      .then(([projectList, threadList]) => {
        if (cancelled) return;
        if (projectList) setProjects(projectList);
        if (threadList) setThreads(threadList);
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "导航数据加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, meta.projectsVersion, meta.historyVersion, pushToast]);

  const collapse = useCallback(() => {
    setExpanded(false);
    setMoreOpen(false);
    setQuery("");
    setShowAllThreads(false);
    goToView({ type: "home" });
  }, [goToView]);

  const expand = useCallback(
    (opts?: { focusSearch?: boolean }) => {
      setExpanded(true);
      if (opts?.focusSearch) {
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    },
    []
  );

  // Esc：Detail → Home → collapse；点击外部 collapse；Cmd/Ctrl+Shift+H toggle
  useEffect(() => {
    if (!expanded && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewRef.current.type !== "home") {
          goToView({ type: "home" });
        } else {
          collapse();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setExpanded((v) => !v);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) collapse();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded, moreOpen, collapse, goToView]);

  // 会话切换完成后：收起 Navigator（与旧 Rail 行为一致）
  const collapseAfterTransitionRef = useRef(false);
  useEffect(() => {
    if (!collapseAfterTransitionRef.current || meta.conversationTransitioning) return;
    collapseAfterTransitionRef.current = false;
    collapse();
  }, [meta.conversationTransitioning, collapse]);

  const transitioning = meta.conversationTransitioning;
  const selectedProject =
    view.type === "project" || view.type === "project-edit" || view.type === "add-conversation"
      ? projects.find((p) => p.id === view.projectId) ?? null
      : null;

  const openThread = useCallback(
    (id: string) => {
      if (transitioning) return;
      collapseAfterTransitionRef.current = true;
      actions.loadConversation(id);
    },
    [actions, transitioning]
  );

  const openProject = useCallback(
    (projectId: string) => {
      goToView({ type: "project", projectId });
    },
    [goToView]
  );

  const newChat = useCallback(() => {
    if (transitioning) return;
    actions.newChat();
    collapse();
  }, [actions, collapse, transitioning]);

  const requestDeleteProject = useCallback(
    (project: KiroProjectRecord) => {
      confirmRequest({
        title: "删除项目？",
        description: "项目中的对话不会被删除，它们将回到未归类对话。",
        confirmLabel: "删除",
        danger: true,
        onConfirm: () => {
          void actions.deleteProject(project.id);
          if (viewRef.current.type !== "home" && viewKeyOf(viewRef.current).endsWith(project.id)) {
            goToView({ type: "home" });
          }
        },
        onCancel: () => {},
      });
    },
    [actions, confirmRequest, goToView]
  );

  const submitProjectForm = useCallback(
    async (values: KiroNavigatorProjectFormValues) => {
      setSubmitting(true);
      try {
        if (viewRef.current.type === "project-create") {
          const record = await actions.createProject(values);
          if (record) {
            // 乐观插入（DB 刷新经 projectsVersion 到达；避免创建后 Detail 瞬时缺项）
            setProjects((prev) => (prev.some((p) => p.id === record.id) ? prev : [...prev, record]));
            goToView({ type: "project", projectId: record.id });
          }
        } else if (viewRef.current.type === "project-edit") {
          const record = await actions.updateProject(viewRef.current.projectId, values);
          if (record) {
            setProjects((prev) => prev.map((p) => (p.id === record.id ? record : p)));
            goToView({ type: "project", projectId: record.id });
          }
        }
      } finally {
        setSubmitting(false);
      }
    },
    [actions, goToView]
  );

  const copyAll = async () => {
    await actions.copyCurrentTranscript();
    setMoreOpen(false);
  };
  const exportMarkdown = () => {
    actions.exportCurrentTranscript();
    setMoreOpen(false);
  };
  const clearConversation = () => {
    setMoreOpen(false);
    confirmRequest({
      title: "清空当前对话？",
      description: "仅清除当前会话中的消息，不影响你的 ClassFlow 数据。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => actions.newChat(),
    });
  };

  const moreMenu = (placement: "top-end" | "right-end") => (
    <KiroMenuPanel open={moreOpen} placement={placement} className="w-[220px]">
      <KiroMenuItem icon={Copy} label="复制全部对话" disabled={!meta.hasMessages} onClick={copyAll} />
      <KiroMenuItem icon={FileDown} label="导出 Markdown" disabled={!meta.hasMessages} onClick={exportMarkdown} />
      <KiroMenuDivider />
      <div className="px-2.5 py-2 space-y-1.5" role="group" aria-label="Kiro 输出字号">
        <p className="text-[10px] font-semibold text-sandrift">输出字号</p>
        <div className="flex items-center gap-0.5 bg-[#F7F5F5] p-0.5 rounded-lg w-fit">
          {(Object.keys(KIRO_OUTPUT_TEXT_SIZE_LABELS) as KiroOutputTextSize[]).map((size) => {
            const active = outputTextSize === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => setOutputTextSize(size)}
                aria-pressed={active}
                aria-label={`${KIRO_OUTPUT_TEXT_SIZE_LABELS[size]}字号`}
                className={cn(
                  "px-2.5 h-6 rounded-md text-[11px] font-semibold transition-colors",
                  active ? "bg-white text-charcoal shadow-subtle" : "text-sandrift hover:text-charcoal"
                )}
              >
                {KIRO_OUTPUT_TEXT_SIZE_LABELS[size]}
              </button>
            );
          })}
        </div>
      </div>
      <KiroMenuDivider />
      <KiroMenuItem icon={Trash2} label="清空当前对话" danger disabled={!meta.hasMessages} onClick={clearConversation} />
    </KiroMenuPanel>
  );

  return (
    <div ref={railRef} data-testid="kiro-navigator" className="hidden md:block absolute left-3 top-20 z-20">
      {/* Motion V1：ONE persistent shell（52 ↔ 288/304 anchored morph；chat geometry 不动） */}
      <div
        data-testid="kiro-navigator-shell"
        data-state={expanded ? "expanded" : "collapsed"}
        className={cn(
          "relative rounded-2xl bg-surface border border-line shadow-card",
          moreOpen ? "overflow-visible" : "overflow-hidden",
          "w-[52px] data-[state=expanded]:w-[288px] lg:data-[state=expanded]:w-[304px]",
          "data-[state=expanded]:max-h-[calc(100dvh-120px)]",
          "transition-[width] duration-[var(--kiro-motion-spatial,220ms)] ease-[var(--ease-standard)]"
        )}
      >
        {/* Collapsed layer：52px（expand 时 absolute 脱离流，不撑高 shell） */}
        {collapsedPresence.mounted && (
          <div
            data-layer="collapsed"
            aria-hidden={expanded}
            className={cn(
              "flex flex-col items-center py-3 gap-1.5",
              expanded && "absolute inset-y-0 left-0 w-[52px] pointer-events-none",
              "transition-[opacity,transform] ease-[var(--ease-standard)]",
              expanded || !collapsedPresence.visible
                ? "opacity-0 -translate-x-[3px] duration-[var(--motion-snap)]"
                : "opacity-100 translate-x-0 duration-[var(--kiro-motion-structure,150ms)] delay-[140ms]"
            )}
          >
            <button
              type="button"
              onClick={() => expand()}
              aria-label={runtimeStatus === "idle" ? "展开对话" : `${runtimeStatusAria}，展开对话`}
              aria-expanded={false}
              title={runtimeStatusAria}
              className="group/plate rounded-xl transition-colors"
            >
              <KiroNavigatorPlate status={runtimeStatus} />
            </button>
            <div className="w-5 h-px bg-line-soft my-0.5" />
            <button
              type="button"
              onClick={newChat}
              aria-label="新对话"
              title={transitioning ? "正在切换会话…" : "新对话"}
              disabled={transitioning}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => expand()}
              aria-label="最近对话"
              title="最近对话"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <HistoryIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => expand({ focusSearch: true })}
              aria-label="搜索对话"
              title="搜索对话"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                goToView({ type: "home" });
                expand();
              }}
              aria-label="打开项目"
              title="项目"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <KIRO_PROJECT_ICON className="w-4 h-4" />
            </button>
            <div className="flex-1" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="对话更多操作"
                aria-expanded={moreOpen}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {moreMenu("right-end")}
            </div>
          </div>
        )}

        {/* Expanded layer：Home / Project Detail / Form / Add-Conversation（同一 shell 内切换） */}
        {expandedPresence.mounted && (
          <div
            role="dialog"
            aria-label="对话"
            data-layer="expanded"
            aria-hidden={!expanded}
            className={cn(
              "flex flex-col overflow-hidden",
              !expanded && "absolute inset-0",
              "transition-[opacity,transform] ease-[var(--ease-standard)]",
              expanded
                ? "opacity-100 translate-x-0 duration-[var(--kiro-motion-structure,150ms)]"
                : "opacity-0 -translate-x-[3px] pointer-events-none duration-[var(--kiro-motion-popover-exit,120ms)]"
            )}
          >
            <div
              className={cn(
                "shrink-0 flex items-center justify-between gap-2 px-2.5 py-2.5 border-b border-line bg-surface",
                "transition-opacity ease-[var(--ease-standard)]",
                expanded ? "opacity-100 duration-[var(--kiro-motion-structure,150ms)] delay-[55ms]" : "opacity-0"
              )}
            >
              <div className="flex items-center gap-2 min-w-0 group/plate">
                <KiroNavigatorPlate size="sm" status={runtimeStatus} emphasized />
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="text-xs font-semibold text-charcoal">Kiro</span>
                  {runtimeStatusText && (
                    <span
                      className="text-[10px] font-medium text-sandrift whitespace-nowrap"
                      data-testid="kiro-navigator-runtime-status-text"
                    >
                      {runtimeStatusText}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={collapse}
                aria-label="收起对话"
                className="p-1 rounded-lg text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div
              key={viewKeyOf(view)}
              className="ux-kiro-view-enter flex-1 min-h-0 flex flex-col overflow-hidden"
              style={{ ["--motion-shift-x" as string]: viewShiftRef.current === "prev" ? "-4px" : "4px" } as React.CSSProperties}
            >
              {view.type === "home" ? (
                <KiroNavigatorHome
                  projects={projects}
                  threads={threads}
                  query={query}
                  showAllThreads={showAllThreads}
                  disabled={transitioning}
                  currentConversationId={meta.currentConversationId}
                  conversationProjectId={meta.conversationProjectId}
                  transitionTargetId={meta.conversationTransition.target}
                  searchInputRef={searchRef}
                  onQueryChange={setQuery}
                  onNewChat={newChat}
                  onOpenProject={openProject}
                  onCreateProject={() => goToView({ type: "project-create" })}
                  onEditProject={(project) => goToView({ type: "project-edit", projectId: project.id })}
                  onDeleteProject={requestDeleteProject}
                  onOpenThread={openThread}
                  onShowAllThreads={() => setShowAllThreads(true)}
                />
              ) : view.type === "project" ? (
                selectedProject ? (
                  <KiroNavigatorProjectDetail
                    project={selectedProject}
                    projectsVersion={meta.projectsVersion}
                    historyVersion={meta.historyVersion}
                    onBack={() => goToView({ type: "home" })}
                    onEdit={(project) => goToView({ type: "project-edit", projectId: project.id })}
                    onDelete={requestDeleteProject}
                    onAddConversation={() => goToView({ type: "add-conversation", projectId: selectedProject.id })}
                    onOpenThread={openThread}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <p className="text-xs font-semibold text-satin-grey">项目不存在</p>
                    <button
                      type="button"
                      onClick={() => goToView({ type: "home" })}
                      className="px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
                    >
                      返回导航
                    </button>
                  </div>
                )
              ) : view.type === "project-create" || view.type === "project-edit" ? (
                <KiroNavigatorProjectForm
                  mode={view.type === "project-create" ? "create" : "edit"}
                  project={view.type === "project-edit" ? selectedProject : null}
                  submitting={submitting}
                  onSubmit={(values) => void submitProjectForm(values)}
                  onCancel={() =>
                    goToView(
                      view.type === "project-edit"
                        ? { type: "project", projectId: view.projectId }
                        : { type: "home" }
                    )
                  }
                />
              ) : (
                <KiroNavigatorAddConversation
                  projectId={view.projectId}
                  projects={projects}
                  refreshToken={meta.projectsVersion}
                  onBack={() => goToView({ type: "project", projectId: view.projectId })}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
