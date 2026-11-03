"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  KIRO_PROJECT_DESCRIPTION_MAX,
  KIRO_PROJECT_INSTRUCTIONS_MAX,
  KIRO_PROJECT_NAME_MAX,
  KiroProjectRecord,
} from "@/lib/ai/projects/types";

export interface KiroNavigatorProjectFormValues {
  name: string;
  description: string;
  instructions: string;
}

/**
 * Kiro Navigator — 项目创建 / 编辑 inline form（V1）。
 * Navigator 内部视图（不弹大型 Modal）；提交 / 取消由父级 Navigator 决定视图流向。
 */
export function KiroNavigatorProjectForm({
  mode,
  project,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  project?: KiroProjectRecord | null;
  submitting?: boolean;
  onSubmit: (values: KiroNavigatorProjectFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-2" data-testid="kiro-navigator-project-form">
      <p className="text-[10px] font-semibold text-sandrift">{mode === "create" ? "新建项目" : "编辑项目"}</p>
      <input
        ref={nameInputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="项目名称"
        aria-label="项目名称"
        maxLength={KIRO_PROJECT_NAME_MAX}
        className="w-full h-8 px-2 rounded-lg text-xs text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述"
        aria-label="项目描述"
        maxLength={KIRO_PROJECT_DESCRIPTION_MAX}
        rows={2}
        className="w-full px-2 py-1.5 rounded-lg text-[11px] text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none resize-none"
      />
      <div>
        <label className="block text-[10px] font-semibold text-sandrift mb-1">项目指令</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例如：回答使用中文，引用注明来源。"
          aria-label="项目指令"
          maxLength={KIRO_PROJECT_INSTRUCTIONS_MAX}
          rows={4}
          className="w-full px-2 py-1.5 rounded-lg text-[11px] text-charcoal placeholder-sandrift bg-[#F7F5F5] border border-line focus:outline-none resize-none leading-relaxed"
        />
        <p className="text-[9px] text-sandrift mt-0.5">仅在项目内生效。</p>
      </div>
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 h-7 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ name, description, instructions })}
          disabled={!name.trim() || submitting}
          aria-label="保存"
          className="px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          保存
        </button>
      </div>
    </div>
  );
}
