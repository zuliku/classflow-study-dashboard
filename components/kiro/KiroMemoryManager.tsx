"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Plus, PencilLine, Trash2, Brain } from "lucide-react";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useAppStore } from "@/store/useAppStore";
import { MEMORY_CATEGORY_LABELS, MEMORY_SCOPE_LABELS, KiroMemory, MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";
import { resolveMemoryScopeId } from "@/lib/ai/memory/manager";
import { cn } from "@/lib/utils";
import { UISelect } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

interface MemoryForm {
  title: string;
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  scopeId: string;
}

const EMPTY_FORM: MemoryForm = {
  title: "",
  content: "",
  category: "other",
  scope: "global",
  scopeId: "",
};

function MemoryFormFields({
  form,
  onChange,
  courses,
  semesterName,
}: {
  form: MemoryForm;
  onChange: (patch: Partial<MemoryForm>) => void;
  courses: Array<{ id: string; name: string }>;
  semesterName: string;
}) {
  return (
    <div className="space-y-3">
      <Field label="标题">
        <Input
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="可留空，自动取内容开头"
          aria-label="记忆标题"
          maxLength={60}
          className="bg-white border-line-strong"
        />
      </Field>
      <Field label="内容">
        <Textarea
          value={form.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="例如：晚上 8 点后不安排高难度任务。"
          aria-label="记忆内容"
          rows={3}
          maxLength={500}
          autoFocus
          className="bg-white border-line-strong"
        />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="分类">
          <UISelect<MemoryCategory>
            value={form.category}
            onChange={(v) => onChange({ category: v })}
            ariaLabel="记忆分类"
            options={(Object.keys(MEMORY_CATEGORY_LABELS) as MemoryCategory[]).map((c) => ({
              value: c,
              label: MEMORY_CATEGORY_LABELS[c],
            }))}
            triggerClassName="h-8 bg-white min-w-[110px]"
          />
        </Field>
        <Field label="范围">
          <UISelect<MemoryScope>
            value={form.scope}
            onChange={(v) => onChange({ scope: v, scopeId: "" })}
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
            onChange={(v) => onChange({ scopeId: v })}
            ariaLabel="关联课程"
            options={[
              { value: "", label: "选择课程" },
              ...courses.map((c) => ({ value: c.id, label: c.name })),
            ]}
            triggerClassName="h-8 bg-white min-w-[120px]"
          />
        </Field>
      )}
      {form.scope === "semester" && (
        <p className="text-[11px] text-sandrift">本学期：{semesterName}</p>
      )}
    </div>
  );
}

/**
 * Kiro Memory Manager：查看 / 添加 / 编辑 / 删除 / 清空长期学习记忆。
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
  const semester = useAppStore((s) => s.semester);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<KiroMemory | null>(null);
  const [form, setForm] = useState<MemoryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) void memory.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 关闭后清理未提交表单，避免下次打开残留
  useEffect(() => {
    if (!open) {
      setFormMode(null);
      setEditing(null);
      setForm(EMPTY_FORM);
    }
  }, [open]);

  const staleMemo = useMemo(() => {
    const state = useAppStore.getState();
    return memory.memories.filter((m) => {
      if (m.scope === "course") return !m.scopeId || !state.courses.some((c) => c.id === m.scopeId);
      if (m.scope === "semester") return !m.scopeId || m.scopeId !== state.semester.id;
      return false;
    });
  }, [memory.memories]);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormMode("create");
  };

  const startEdit = (m: KiroMemory) => {
    setEditing(m);
    setForm({
      title: m.title,
      content: m.content,
      category: m.category,
      scope: m.scope,
      scopeId: m.scopeId ?? "",
    });
    setFormMode("edit");
  };

  const cancelForm = () => {
    setFormMode(null);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const commit = async () => {
    if (saving) return;
    if (!form.content.trim()) {
      pushToast({ message: "请输入记忆内容。", type: "error" });
      return;
    }
    if (form.scope === "course" && !form.scopeId) {
      pushToast({ message: "请选择关联课程。", type: "error" });
      return;
    }
    const scopeId = resolveMemoryScopeId(form.scope, form.scopeId, semester.id);
    setSaving(true);
    try {
      if (formMode === "edit" && editing) {
        const r = await memory.update(editing.id, {
          title: form.title,
          content: form.content,
          category: form.category,
          scope: form.scope,
          scopeId,
        });
        if (r.ok) {
          pushToast({ message: "记忆已更新" });
          onChanged?.();
          cancelForm();
          return;
        }
        pushToast({
          message:
            r.code === "MEMORY_SENSITIVE_CONTENT"
              ? "内容包含敏感信息，无法保存。"
              : r.code === "MEMORY_DISABLED"
                ? "记忆已关闭，请先在设置中开启。"
                : "更新失败。",
          type: "error",
        });
        return;
      }

      const r = await memory.save({
        title: form.title.trim() || undefined,
        content: form.content,
        category: form.category,
        scope: form.scope,
        scopeId,
      });
      if (r.created) {
        pushToast({ message: "已添加记忆" });
        onChanged?.();
        cancelForm();
        return;
      }
      if (r.code === "MEMORY_SENSITIVE_CONTENT") {
        pushToast({ message: "内容包含敏感信息，无法保存。", type: "error" });
      } else if (r.code === "MEMORY_LIMIT_REACHED") {
        pushToast({ message: "记忆已达 50 条上限。", type: "error" });
      } else if (r.code === "MEMORY_DISABLED") {
        pushToast({ message: "记忆已关闭，请先在设置中开启。", type: "error" });
      } else {
        pushToast({ message: "已有相同记忆。" });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string, title?: string) => {
    confirmRequest({
      title: "删除这条记忆？",
      description: title ? `「${title}」删除后不可恢复。` : "删除后不可恢复。",
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => {
        void memory.remove(id).then(() => {
          pushToast({ message: "已删除记忆" });
          onChanged?.();
        });
      },
    });
  };

  const clearAll = () => {
    confirmRequest({
      title: "清空 Kiro 的全部记忆？",
      description: "不会删除聊天记录、课程、任务与资料。",
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

  const formCard = (
    <div className="rounded-xl bg-[#F7F5F5] border border-line p-3 space-y-3">
      <MemoryFormFields
        form={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        courses={courses}
        semesterName={semester.name}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={cancelForm}>
          取消
        </Button>
        <Button variant="primary" size="sm" onClick={commit} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="kiro-memory-manager"
      stackZ={50}
      closeOnBackdrop
      onEscapeKeyDown={(event) => {
        if (formMode !== null) {
          event.preventDefault();
          cancelForm();
        }
      }}
      aria-label="Kiro 记忆"
      data-testid="kiro-memory-manager"
      className="max-w-lg max-h-[80dvh] border-line-strong rounded-2xl shadow-card"
    >
      {/* Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-pastel-mint flex items-center justify-center">
            <Brain className="w-4 h-4 text-charcoal" />
          </span>
          <h3 className="text-sm font-bold text-charcoal">Kiro 记忆</h3>
          <span className="text-[10px] font-semibold text-sandrift bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded-md">
            {memory.memories.length} 条
          </span>
        </div>
        <div className="flex items-center gap-1">
          {formMode === null && (
            <Button variant="secondary" size="sm" onClick={startCreate} className="h-7 px-2 text-[11px]" data-testid="kiro-memory-add">
              <Plus className="w-3.5 h-3.5" />
              添加
            </Button>
          )}
          {memory.memories.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-7 px-2 text-[11px] text-danger hover:text-danger hover:bg-danger-bg"
            >
              清空
            </Button>
          )}
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="关闭记忆">
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {formMode === "create" && formCard}
        {memory.memories.length === 0 && formMode === null ? (
          <div className="py-10 text-center">
            <Brain className="w-6 h-6 text-sandrift mx-auto" />
            <p className="text-sm font-semibold text-charcoal mt-2">暂无记忆</p>
            <Button variant="secondary" size="sm" onClick={startCreate} className="mt-3">
              <Plus className="w-3.5 h-3.5" />
              添加记忆
            </Button>
          </div>
        ) : (
          memory.memories.map((m) => {
            const stale = m.scope === "course" && !courses.some((c) => c.id === m.scopeId);
            return (
              <div key={m.id} className={cn("rounded-xl bg-[#F7F5F5] border border-line p-3", editing?.id === m.id && "ring-1 ring-line-strong")}>
                {formMode === "edit" && editing?.id === m.id ? (
                  formCard
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
                          onClick={() => remove(m.id, m.title)}
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
          <p className="text-[10px] text-sandrift pt-1">有 {staleMemo.length} 条记忆关联的课程或学期已不存在。</p>
        )}
      </div>
    </Dialog>
  );
}
