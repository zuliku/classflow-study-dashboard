"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, PencilLine, Trash2, Brain } from "lucide-react";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useAppStore } from "@/store/useAppStore";
import { MEMORY_CATEGORY_LABELS, MEMORY_SCOPE_LABELS, KiroMemory, MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";
import { cn } from "@/lib/utils";
import { UISelect } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="kiro-memory-manager"
      stackZ={50}
      closeOnBackdrop
      onEscapeKeyDown={(event) => {
        // 编辑态：第一次 Esc 只退出编辑，不关闭 Manager
        if (editing !== null) {
          event.preventDefault();
          setEditing(null);
        }
      }}
      aria-label="Kiro 记忆"
      data-testid="kiro-memory-manager"
      className="max-w-lg max-h-[80dvh] border-line-strong rounded-2xl shadow-card"
    >
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
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="关闭记忆"
          >
            <X className="w-4 h-4" />
          </IconButton>
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
                    <div className="space-y-3">
                      <Field label="标题">
                        <Input
                          value={form.title}
                          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                          aria-label="记忆标题"
                          className="bg-white border-line-strong"
                        />
                      </Field>
                      <Field label="内容">
                        <Textarea
                          value={form.content}
                          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                          aria-label="记忆内容"
                          rows={2}
                          className="bg-white border-line-strong"
                        />
                      </Field>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="分类">
                          <UISelect<MemoryCategory>
                            value={form.category}
                            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                            ariaLabel="记忆分类"
                            options={(Object.keys(MEMORY_CATEGORY_LABELS) as MemoryCategory[]).map(
                              (c) => ({ value: c, label: MEMORY_CATEGORY_LABELS[c] })
                            )}
                            triggerClassName="h-8 bg-white min-w-[110px]"
                          />
                        </Field>
                        <Field label="范围">
                          <UISelect<MemoryScope>
                            value={form.scope}
                            onChange={(v) => setForm((f) => ({ ...f, scope: v, scopeId: "" }))}
                            ariaLabel="记忆范围"
                            options={(Object.keys(MEMORY_SCOPE_LABELS) as MemoryScope[]).map((s) => ({
                              value: s,
                              label: MEMORY_SCOPE_LABELS[s],
                            }))}
                            triggerClassName="h-8 bg-white min-w-[110px]"
                          />
                        </Field>
                      </div>
                      {form.scope === "course" && (
                        <Field label="关联课程">
                          <UISelect
                            value={form.scopeId}
                            onChange={(v) => setForm((f) => ({ ...f, scopeId: v }))}
                            ariaLabel="关联课程"
                            options={[
                              { value: "", label: "选择课程" },
                              ...courses.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                            triggerClassName="h-8 bg-white min-w-[120px]"
                          />
                        </Field>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                          取消
                        </Button>
                        <Button variant="primary" size="sm" onClick={commitEdit}>
                          保存
                        </Button>
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
                          <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(m)}
                            aria-label={`编辑记忆 ${m.title}`}
                            className="h-6 w-6"
                          >
                            <PencilLine className="w-3.5 h-3.5" />
                          </IconButton>
                          <IconButton
                            variant="danger"
                            size="sm"
                            onClick={() => remove(m.id)}
                            aria-label={`删除记忆 ${m.title}`}
                            className="h-6 w-6"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconButton>
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
        <div className="shrink-0 px-4 py-2.5 border-t border-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-[10px] text-sandrift leading-relaxed max-w-[420px]">
            记忆保存在当前浏览器中。只有完成当前请求需要时，相关记忆内容才会发送给你选择的 AI 服务。
          </p>
          {memory.memories.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="shrink-0 text-danger hover:text-danger hover:bg-danger-bg"
            >
              清空全部
            </Button>
          )}
        </div>
      </Dialog>
  );
}
