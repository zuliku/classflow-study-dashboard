"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FolderKanban, ChevronLeft, X, Plus, Pencil, Trash2, ChevronsLeft, ArrowLeft } from "lucide-react";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { usePresence } from "@/lib/usePresence";
import { KiroProjectRecord, KIRO_PROJECT_NAME_MAX, KIRO_PROJECT_DESCRIPTION_MAX, KIRO_PROJECT_INSTRUCTIONS_MAX } from "@/lib/ai/projects/types";
import { KiroProjectFileRecord, MAX_PROJECT_FILES_PER_PROJECT } from "@/lib/ai/projects/files/types";
import { listKiroProjects, listProjectConversations } from "@/lib/ai/projects/db";
import {
  listProjectFiles,
  createProjectFile,
  deleteProjectFile,
} from "@/lib/ai/projects/files/db";
import { routeAttachment } from "@/lib/ai/attachments/router";
import { listConversations } from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { cn } from "@/lib/utils";

export type ProjectPanelMode = "expanded" | "collapsed" | "closed";

type ProjectView = "list" | "detail" | "add";

/**
 * Kiro Project Panel（V1）：右侧 Floating Project Rail。
 * - expanded（296/lg 304px）→ collapsed（52px）→ closed（usePresence 退出动画后卸载）
 * - List → Detail → Add-Conversation 三视图
 * - 全部数据来自 Session actions + IndexedDB（低频 metadata；lazy load）
 * - Conversation membership 单一事实源 = conversations.projectId
 */
export function KiroProjectPanel({
  mode,
  onSetMode,
  onOpenConversation,
}: {
  mode: ProjectPanelMode;
  onSetMode: (mode: ProjectPanelMode) => void;
  onOpenConversation: (id: string) => void;
}) {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  const [view, setView] = useState<ProjectView>("list");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<KiroProjectRecord[]>([]);
  const [detailConversations, setDetailConversations] = useState<KiroConversationRecord[]>([]);
  const [addCandidates, setAddCandidates] = useState<KiroConversationRecord[]>([]);
  const loadedProjectsVersionRef = useRef(-1);

  // 编辑/创建 inline form
  const [formOpen, setFormOpen] = useState<"create" | KiroProjectRecord["id"] | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  // V1.3A：Project Files（Detail 按需加载；上传/删除后 refreshProjects 触发重载）
  const [projectFiles, setProjectFiles] = useState<KiroProjectFileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const expanded = mode === "expanded";
  const { mounted, visible } = usePresence(mode !== "closed", 160);

  const openView = useCallback(
    (v: ProjectView, projectId?: string) => {
      setView(v);
      if (projectId !== undefined) setSelectedProjectId(projectId);
    },
    []
  );

  // lazy load：首次 expanded 才读 Project DB；projectsVersion 变更后刷新
  useEffect(() => {
    if (!expanded) return;
    if (loadedProjectsVersionRef.current === meta.projectsVersion) return;
    loadedProjectsVersionRef.current = meta.projectsVersion;
    listKiroProjects()
      .then(setProjects)
      .catch(() => pushToast({ message: "项目加载失败，请重试", type: "error" }));
  }, [expanded, meta.projectsVersion, pushToast]);

  // Detail：进入时加载项目内 conversations（projectsVersion 变化也刷新）
  useEffect(() => {
    if (!expanded || view !== "detail" || !selectedProjectId) return;
    let cancelled = false;
    listProjectConversations(selectedProjectId)
      .then((list) => {
        if (!cancelled) setDetailConversations(list);
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "对话列表加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, view, selectedProjectId, meta.projectsVersion, pushToast]);

  // V1.3A：Detail 按需加载 Project Files
  useEffect(() => {
    if (!expanded || view !== "detail" || !selectedProjectId) return;
    let cancelled = false;
    listProjectFiles(selectedProjectId)
      .then((list) => {
        if (!cancelled) setProjectFiles(list);
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "项目资料加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, view, selectedProjectId, meta.projectsVersion, pushToast]);

  // Add View：加载全部 conversations（不属于当前项目；含未归类与来自其他项目的）
  useEffect(() => {
    if (!expanded || view !== "add") return;
    let cancelled = false;
    listConversations()
      .then((all) => {
        if (cancelled) return;
        setAddCandidates(all.filter((c) => c.projectId !== selectedProjectId));
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "对话列表加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, view, selectedProjectId, meta.projectsVersion, pushToast]);

  if (!mounted) return null;

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const startCreate = () => {
    setFormName("");
    setFormDescription("");
    setFormInstructions("");
    setFormOpen("create");
  };
  const startEdit = (p: KiroProjectRecord) => {
    setFormName(p.name);
    setFormDescription(p.description ?? "");
    setFormInstructions(p.instructions ?? "");
    setFormOpen(p.id);
  };
  const submitForm = async () => {
    if (formOpen === "create") {
      const record = await actions.createProject({
        name: formName,
        description: formDescription,
        instructions: formInstructions,
      });
      if (record) {
        setFormOpen(null);
        setView("detail");
        setSelectedProjectId(record.id);
      }
    } else if (formOpen) {
      const record = await actions.updateProject(formOpen, {
        name: formName,
        description: formDescription,
        instructions: formInstructions,
      });
      if (record) setFormOpen(null);
    }
  };

  const requestDelete = (p: KiroProjectRecord) => {
    confirmRequest({
      title: "删除项目？",
      description: "项目中的对话不会被删除，它们将回到未归类对话。",
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => {
        void actions.deleteProject(p.id);
        if (selectedProjectId === p.id) {
          setSelectedProjectId(null);
          setView("list");
        }
      },
      onCancel: () => {},
    });
  };

  const moveConversation = async (conversationId: string, projectId: string | null, label: string) => {
    const ok = await actions.assignConversationToProject(conversationId, projectId);
    if (ok) pushToast({ message: label });
  };

  // ---- V1.3A：Project Files 上传 / 删除 ----
  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedProjectId || uploading) return;
    const quotaLeft = MAX_PROJECT_FILES_PER_PROJECT - projectFiles.length;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const routed = routeAttachment(file);
      if (!routed.ok || routed.kind === "image") {
        pushToast({ message: "项目资料暂支持 PDF、DOCX、TXT 和 Markdown。", type: "error" });
        continue;
      }
      if (accepted.length >= quotaLeft) break;
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    if (accepted.length < Array.from(files).length) {
      pushToast({ message: `项目最多保存 ${MAX_PROJECT_FILES_PER_PROJECT} 个资料，已添加可容纳的文件。` });
    }
    setUploading(true);
    try {
      let added = 0;
      for (const file of accepted) {
        const routed = routeAttachment(file);
        if (!routed.ok) continue;
        await createProjectFile({
          projectId: selectedProjectId,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          kind: routed.kind as KiroProjectFileRecord["kind"],
          blob: file,
        });
        added++;
      }
      actions.refreshProjects();
      if (added > 0) pushToast({ message: `已添加 ${added} 个资料` });
    } catch (err) {
      const message = (err as { message?: string })?.message;
      if (message === "PROJECT_FILE_LIMIT_REACHED") {
        pushToast({ message: `项目最多保存 ${MAX_PROJECT_FILES_PER_PROJECT} 个资料。`, type: "error" });
      } else {
        pushToast({ message: "资料上传失败，请重试", type: "error" });
      }
    } finally {
      setUploading(false);
    }
  };

  const requestDeleteFile = (f: KiroProjectFileRecord) => {
    confirmRequest({
      title: "删除项目资料？",
      description: "这不会删除你的聊天记录，但 Kiro 将无法再读取该资料。",
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => {
        void deleteProjectFile(f.id)
          .then(() => {
            actions.refreshProjects();
            pushToast({ message: "已删除资料" });
          })
          .catch(() => pushToast({ message: "资料删除失败，请重试", type: "error" }));
      },
      onCancel: () => {},
    });
  };

  const transitioning = meta.conversationTransitioning;

  const header = (
    <div className="shrink-0 flex items-center justify-between gap-2 px-2.5 py-2.5 border-b border-line">
      {view === "list" ? (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 flex items-center justify-center rounded-lg bg-pastel-mint text-charcoal">
              <FolderKanban className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-semibold text-charcoal">项目</span>
          </div>
          <div className="flex items-center">
            <button
              onClick={() => onSetMode("collapsed")}
              aria-label="收起项目"
              title="收起项目"
              className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onSetMode("closed")}
              aria-label="关闭项目"
              title="关闭项目"
              className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setView("list")}
              aria-label="返回项目列表"
              className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-charcoal truncate">{view === "detail" ? selectedProject?.name ?? "项目" : "添加历史对话"}</span>
          </div>
          <button
            onClick={() => onSetMode("closed")}
            aria-label="关闭项目"
            title="关闭项目"
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );

  const projectRow = (p: KiroProjectRecord) => {
    // V1.1：conversationProjectId 即表达「当前 Session Project」；
    // transient（尚未发送第一条消息、无 conversationId）同样正确显示
    const isCurrentProject = meta.conversationProjectId === p.id;
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        aria-label={`打开项目 ${p.name}`}
        onClick={() => openView("detail", p.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter") openView("detail", p.id);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-alabaster transition-colors cursor-pointer group"
      >
        <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-lg bg-alabaster text-sandrift">
          <FolderKanban className="w-3.5 h-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-charcoal truncate">
            {p.name}
            {isCurrentProject && (
              <span className="ml-1.5 text-[9px] font-bold text-charcoal bg-pastel-mint/70 rounded-full px-1.5 py-0.5">
                当前项目
              </span>
            )}
          </span>
          <span className="block text-[10px] text-sandrift truncate">
            {p.description ?? `${p.name} 项目`} · {formatHistoryTime(p.updatedAt)}
          </span>
        </span>
        <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startEdit(p);
            }}
            aria-label={`编辑项目 ${p.name}`}
            className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              requestDelete(p);
            }}
            aria-label={`删除项目 ${p.name}`}
            className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-danger transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
    );
  };

  return (
    <div
      data-testid="kiro-project-panel"
      className="hidden md:block absolute right-3 top-20 z-20 transition-[width] duration-200 ease-standard"
      style={{ width: expanded ? 296 : 52 }}
    >
      <div
        className={cn(
          "transition-[opacity,transform] duration-[var(--motion-panel)] ease-standard",
          visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"
        )}
      >
        {expanded ? (
          /* ---------- Expanded Panel（296/lg 304px） ---------- */
          <div
            role="dialog"
            aria-label="项目"
            className="w-[296px] lg:w-[304px] max-h-[calc(100dvh-112px)] h-fit rounded-2xl bg-surface border border-line shadow-card flex flex-col overflow-hidden"
          >
            {header}

            {formOpen ? (
              <div className="p-2.5 space-y-2 border-b border-line">
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="项目名称"
                  aria-label="项目名称"
                  maxLength={KIRO_PROJECT_NAME_MAX}
                  autoFocus
                  className="w-full h-8 px-2 rounded-lg text-xs text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none"
                />
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="描述（可选）"
                  aria-label="项目描述"
                  maxLength={KIRO_PROJECT_DESCRIPTION_MAX}
                  rows={2}
                  className="w-full px-2 py-1.5 rounded-lg text-[11px] text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none resize-none"
                />
                <div>
                  <label className="block text-[10px] font-semibold text-sandrift mb-1">项目指令</label>
                  <textarea
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                    placeholder="例如：回答优先使用中文；引用资料时注明来源；学习计划按周拆分。"
                    aria-label="项目指令"
                    maxLength={KIRO_PROJECT_INSTRUCTIONS_MAX}
                    rows={4}
                    className="w-full px-2 py-1.5 rounded-lg text-[11px] text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none resize-none leading-relaxed"
                  />
                  <p className="text-[9px] text-sandrift mt-0.5">Kiro 在此项目中的工作偏好。不会授予额外权限。</p>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setFormOpen(null)}
                    className="px-2.5 h-7 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void submitForm()}
                    disabled={!formName.trim()}
                    aria-label="保存"
                    className="px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : null}

            {view === "list" ? (
              /* ---------- List View ---------- */
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
                <button
                  onClick={startCreate}
                  aria-label="新建项目"
                  className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors mb-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建项目
                </button>
                {projects.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-8 text-center">
                    <FolderKanban className="w-5 h-5 text-sandrift" />
                    <p className="text-xs font-semibold text-satin-grey mt-1">还没有项目</p>
                    <p className="text-[11px] text-sandrift">用项目整理相关的 Kiro 对话。</p>
                    <button
                      onClick={startCreate}
                      className="mt-2 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
                    >
                      创建第一个项目
                    </button>
                  </div>
                ) : (
                  projects.map(projectRow)
                )}
              </div>
            ) : view === "detail" ? (
              /* ---------- Detail View ---------- */
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
                {selectedProject?.description ? (
                  <p className="text-[11px] text-satin-grey px-1.5 pb-1 leading-relaxed">{selectedProject.description}</p>
                ) : null}
                {/* Projects V1.2：Instructions 紧凑展示（不永久铺满面板；可编辑） */}
                <div className="px-1.5 pb-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[10px] font-semibold text-sandrift">项目指令</p>
                    <button
                      onClick={() => selectedProject && startEdit(selectedProject)}
                      aria-label={selectedProject?.instructions ? "编辑项目指令" : "添加项目指令"}
                      className="text-[10px] font-bold text-charcoal bg-alabaster hover:bg-pastel-mint rounded-md px-1.5 h-5 transition-colors"
                    >
                      {selectedProject?.instructions ? "编辑" : "添加"}
                    </button>
                  </div>
                  {selectedProject?.instructions ? (
                    <p className="text-[10px] text-satin-grey leading-relaxed mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-alabaster/60 px-2 py-1.5">
                      {selectedProject.instructions}
                    </p>
                  ) : (
                    <p className="text-[10px] text-sandrift mt-0.5">未设置项目指令</p>
                  )}
                </div>
                {/* V1.3A：项目资料（index-only；正文经 read_project_file 按需读取） */}
                <div className="px-1.5 pb-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[10px] font-semibold text-sandrift">项目资料 · {projectFiles.length}</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || projectFiles.length >= MAX_PROJECT_FILES_PER_PROJECT}
                      aria-label="添加项目资料"
                      className="flex items-center gap-0.5 px-1.5 h-5 rounded-md text-[10px] font-bold text-charcoal bg-alabaster hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3 h-3" />
                      添加资料
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.docx,.txt,.md,.markdown"
                      aria-label="上传项目资料"
                      className="hidden"
                      onChange={(e) => {
                        void handleUploadFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {projectFiles.length === 0 ? (
                    <p className="text-[10px] text-sandrift mt-0.5">暂无项目资料</p>
                  ) : (
                    <div className="mt-0.5 space-y-0.5">
                      {projectFiles.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg group/file">
                          <FileTextIcon />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold text-charcoal truncate">{f.name}</span>
                            <span className="block text-[9px] text-sandrift">
                              {f.kind.toUpperCase()} · {formatBytes(f.sizeBytes)}
                            </span>
                          </span>
                          <button
                            onClick={() => requestDeleteFile(f)}
                            aria-label={`删除项目资料 ${f.name}`}
                            className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-danger transition-colors opacity-0 group-hover/file:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1.5 px-1.5 pt-1 pb-0.5">
                  <p className="text-[10px] font-semibold text-sandrift">对话 · {detailConversations.length}</p>
                  <div className="flex items-center gap-1">
                    {/* V1.1：Project-scoped 新对话（primary）；Panel 保持打开 */}
                    <button
                      onClick={() => {
                        if (!selectedProjectId || transitioning) return;
                        actions.newChatInProject(selectedProjectId);
                      }}
                      disabled={transitioning}
                      aria-label="在此项目中新建对话"
                      className="flex items-center gap-1 px-2 h-6 rounded-lg text-[10px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3 h-3" />
                      新对话
                    </button>
                    <button
                      onClick={() => setView("add")}
                      disabled={transitioning}
                      aria-label="添加历史对话"
                      className="flex items-center gap-1 px-2 h-6 rounded-lg text-[10px] font-semibold text-satin-grey bg-alabaster hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      添加历史
                    </button>
                  </div>
                </div>
                {/* V1.1：transient 当前项目提示（尚未发送第一条消息；不计入 对话 · N） */}
                {meta.conversationProjectId === selectedProjectId && meta.currentConversationId === null ? (
                  <div
                    role="status"
                    aria-label="当前项目新对话提示"
                    className="px-1.5 py-1.5 mb-0.5 text-[10px] font-semibold text-charcoal bg-pastel-mint/50 rounded-lg"
                  >
                    当前 · 新对话（发送第一条消息后才会保存）
                  </div>
                ) : null}
                {detailConversations.length === 0 && !(meta.conversationProjectId === selectedProjectId && meta.currentConversationId === null) ? (
                  <div className="flex flex-col items-center gap-1 py-7 text-center">
                    <p className="text-xs font-semibold text-satin-grey">这个项目还没有对话</p>
                    <button
                      onClick={() => setView("add")}
                      className="mt-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
                    >
                      添加历史对话
                    </button>
                  </div>
                ) : (
                  detailConversations.map((c) => {
                    const isCurrent = meta.currentConversationId === c.id;
                    return (
                      <div key={c.id} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg group">
                        <button
                          onClick={() => onOpenConversation(c.id)}
                          disabled={transitioning}
                          aria-label={`打开对话 ${c.title}`}
                          className="min-w-0 flex-1 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <span className="block text-xs font-semibold text-charcoal truncate">
                            {c.title}
                            {isCurrent && <span className="ml-1.5 text-[9px] font-bold text-charcoal bg-pastel-mint/70 rounded-full px-1.5 py-0.5">当前</span>}
                          </span>
                          <span className="block text-[10px] text-sandrift">{formatHistoryTime(c.updatedAt)}</span>
                        </button>
                        <button
                          onClick={() => void moveConversation(c.id, null, "已移出项目")}
                          disabled={transitioning}
                          aria-label={`从项目移出 ${c.title}`}
                          title="移出项目（不删除对话）"
                          className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* ---------- Add Conversation View ---------- */
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
                <p className="text-[10px] font-semibold text-sandrift px-1.5 pt-1 pb-1">其他对话</p>
                {addCandidates.length === 0 ? (
                  <p className="text-[11px] text-sandrift text-center py-6">没有可添加的对话</p>
                ) : (
                  addCandidates.map((c) => {
                    const fromProject = projects.find((p) => p.id === c.projectId);
                    return (
                      <div key={c.id} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg group">
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-charcoal truncate">{c.title}</span>
                          <span className="block text-[10px] text-sandrift truncate">
                            {c.projectId ? `来自「${fromProject?.name ?? "其他项目"}」` : "未归类"} · {formatHistoryTime(c.updatedAt)}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            if (!selectedProjectId) return;
                            void moveConversation(c.id, selectedProjectId, c.projectId ? "已移动" : "已添加");
                          }}
                          disabled={transitioning}
                          aria-label={`${c.projectId ? "移动" : "添加"}对话 ${c.title}`}
                          className="px-2 h-6 rounded-lg text-[10px] font-bold text-charcoal bg-pastel-mint/70 hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {c.projectId ? "移动" : "添加"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ) : (
          /* ---------- Collapsed Rail（52px） ---------- */
          <div className="w-[52px] rounded-2xl bg-surface border border-line shadow-subtle flex flex-col items-center py-3 gap-1.5">
            <button
              onClick={() => onSetMode("expanded")}
              aria-label="项目"
              aria-expanded={false}
              title="项目"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <FolderKanban className="w-4 h-4" />
            </button>
            <div className="w-5 h-px bg-line-soft my-0.5" />
            <button
              onClick={() => onSetMode("closed")}
              aria-label="关闭项目"
              title="关闭项目"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FileTextIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-sandrift shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

