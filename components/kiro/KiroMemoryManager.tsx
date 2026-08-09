"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, PencilLine, Trash2, Brain } from "lucide-react";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useAppStore } from "@/store/useAppStore";
import { MEMORY_CATEGORY_LABELS, MEMORY_SCOPE_LABELS, KiroMemory, MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";
import { cn } from "@/lib/utils";

/**
 * Kiro Memory Manager（Task 9）：查看 / 编辑 / 删除 / 清空长期学习记忆。
 * 复用 useKiroMemory（IndexedDB）；独立 Modal（Esc/遮罩关闭）。
 */
export function KiroMemoryManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const memory = useKiroMemory();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const courses = useAppStore((s) => s.courses);
  const [editing, setEditing] = useState<KiroMemory | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "study-habit" as MemoryCategory, scope: "global" as MemoryScope, scopeId: "" });

  useEffect(() => {
    if (open) void memory.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) setEditing(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editing, onClose]);

  const staleMemo = useMemo(() => {
    const state = useAppStore.getState();
    return memory.memories.filter((m) => {
      if (m.scope === "course") return !m.scopeId || !state.courses.some((c) => c.id === m.scopeId);
      if (m.scope === "semester") return !m.scopeId || m.scopeId !== state.semester.id;
      return false;
    });
  }, [memory.memories]);

  if (!open) return null;

  const startEdit = (m: KiroMemory) => {
    setEditing(m);
    setForm({ title: m.title, content: m.content, category: m.category, scope: m.scope, scopeId: m.scopeId ?? "" });
  };

  const commitEdit = async () => {
    if (!editing) return;
    const r = await memory.update(editing.id, {
      title: form.title,
      content: form.content,
      category: form.category,
      scope: form.scope,
      scopeId: form.scope === "global" ? undefined : form.scopeId || undefined,
    });
    if (r.ok) {
      pushToast({ message: "记忆已更新" });
      onChanged?.();
      setEditing(null);
    } else {
      pushToast({ message: r.code === "MEMORY_SENSITIVE_CONTENT" ? "内容包含敏感信息，无法保存。" : "更新失败。", type: "error" });
    }
  };

  const remove = async (id: string) => {
    await memory.remove(id);
    pushToast({ message: "已删除记忆" });
    onChanged?.();
  };

  const clearAll = () => {
    confirmRequest({
      title: "清空 Kiro 的全部记忆？",
      description: "不会删除聊天记录、课程、任务或资料。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => {
        void memory.clear().then(() => {
          pushToast({ message: "记忆已清空" });
          onChanged?.();
        });
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="kiro-memory-manager">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Kiro 记忆" className="relative w-full max-w-lg bg-surface border border-line-strong rounded-2xl shadow-card flex flex-col max-h-[80dvh] ux-modal-panel">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-pastel-mint flex items-center justify-center">
              <Brain className="w-4 h-4 text-charcoal" />
            </span>
            <h3 className="text-sm font-bold text-charcoal">Kiro 记忆</h3>
            <span className="text-[10px] font-semibold text-sandrift bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded-md">
              {memory.memories.length} 条
            </span>
          </div>
          <button onClick={onClose} aria-label="关闭记忆" className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
          {memory.memories.length === 0 ? (
            <div className="py-10 text-center">
              <Brain className="w-6 h-6 text-sandrift mx-auto" />
              <p className="text-sm font-semibold text-charcoal mt-2">暂无记忆</p>
              <p className="text-xs text-sandrift mt-1 leading-relaxed">对 Kiro 说「记住我一般晚上学习」之类的偏好，就会保存在这里。</p>
            </div>
          ) : (
            memory.memories.map((m) => {
              const stale = m.scope === "course" && !courses.some((c) => c.id === m.scopeId);
              return (
                <div key={m.id} className={cn("rounded-xl bg-[#F7F5F5] border border-line p-3", editing?.id === m.id && "ring-1 ring-line-strong")}>
                  {editing?.id === m.id ? (
                    <div className="space-y-2">
                      <input
                        value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        aria-label="记忆标题"
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1.5 text-xs text-charcoal focus:outline-none"
                      />
                      <textarea
                        value={form.content}
                        onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                        aria-label="记忆内容"
                        rows={2}
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1.5 text-xs text-charcoal focus:outline-none resize-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={form.category}
                          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as MemoryCategory }))}
                          aria-label="记忆分类"
                          className="bg-white border border-line rounded-lg px-2 py-1 text-[11px] text-charcoal focus:outline-none"
                        >
                          {(Object.keys(MEMORY_CATEGORY_LABELS) as MemoryCategory[]).map((c) => (
                            <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                        <select
                          value={form.scope}
                          onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as MemoryScope, scopeId: "" }))}
                          aria-label="记忆范围"
                          className="bg-white border border-line rounded-lg px-2 py-1 text-[11px] text-charcoal focus:outline-none"
                        >
                          {(Object.keys(MEMORY_SCOPE_LABELS) as MemoryScope[]).map((s) => (
                            <option key={s} value={s}>{MEMORY_SCOPE_LABELS[s]}</option>
                          ))}
                        </select>
                        {form.scope === "course" && (
                          <select
                            value={form.scopeId}
                            onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
                            aria-label="关联课程"
                            className="bg-white border border-line rounded-lg px-2 py-1 text-[11px] text-charcoal focus:outline-none"
                          >
                            <option value="">选择课程</option>
                            {courses.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        )}
                        <div className="ml-auto flex items-center gap-1.5">
                          <button onClick={() => setEditing(null)} className="px-2 h-7 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster transition-colors">取消</button>
                          <button onClick={commitEdit} className="px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors">保存</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-bold text-charcoal">{m.title}</p>
                      <p className="text-[11px] text-satin-grey mt-0.5 leading-relaxed">{m.content}</p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-sandrift bg-white border border-line-soft px-1.5 py-0.5 rounded-md">
                            {MEMORY_CATEGORY_LABELS[m.category]} · {MEMORY_SCOPE_LABELS[m.scope]}
                            {m.scope === "course" && (stale ? " · 关联课程已不存在" : ` · ${courses.find((c) => c.id === m.scopeId)?.name ?? ""}`)}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => startEdit(m)}
                            aria-label={`编辑记忆 ${m.title}`}
                            className="p-1.5 rounded-lg text-sandrift hover:bg-white hover:text-charcoal transition-colors"
                          >
                            <PencilLine className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => remove(m.id)}
                            aria-label={`删除记忆 ${m.title}`}
                            className="p-1.5 rounded-lg text-sandrift hover:bg-white hover:text-danger transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
          {staleMemo.length > 0 && (
            <p className="text-[10px] text-sandrift pt-1">有 {staleMemo.length} 条记忆关联的课程/学期已不存在，仍保留在管理中，但不会进入 Kiro 的当前上下文。</p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-2.5 border-t border-line flex items-center justify-between gap-2">
          <p className="text-[10px] text-sandrift leading-relaxed">
            记忆保存在当前浏览器中。只有完成当前请求需要时，相关记忆内容才会发送给你选择的 AI 服务。
          </p>
          {memory.memories.length > 0 && (
            <button onClick={clearAll} className="shrink-0 text-[11px] font-bold text-sandrift hover:text-danger transition-colors">
              清空全部
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
