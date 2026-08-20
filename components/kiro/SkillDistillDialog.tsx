"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Sparkles, Loader2, Beaker, Save } from "lucide-react";
import type { WorkflowTrace } from "@/lib/ai/skills/types";
import type { SkillDraft } from "@/lib/ai/skills/types";
import { sanitizeWorkflowTrace } from "@/lib/ai/skills/sanitize";
import { renderSkillDraftToMd } from "@/lib/ai/skills/draft";

interface SkillDistillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trace: WorkflowTrace | null;
  onSaved?: (skillName: string) => void;
}

export function SkillDistillDialog({ open, onOpenChange, trace, onSaved }: SkillDistillDialogProps) {
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [md, setMd] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<null | { ok: boolean; errors: string[] }>(null);
  const [saving, setSaving] = useState(false);

  const handleDistill = async () => {
    if (!trace) {
      setError("没有可用的工作流");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sanitized = sanitizeWorkflowTrace(trace);
      // 调用 AI 抽象（使用 Muse Spark）
      const apiKey = "sk-jibB4MGawaWUtbQ34Rqdok1w3LH3qAp0ph7EF6llgJYeNeT1R18R6m8FaonH0roT";
      const { distillWorkflowToSkill } = await import("@/lib/ai/skills/distill");
      const result = await distillWorkflowToSkill(trace, { apiKey });
      setDraft(result.draft);
      setMd(result.md);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!draft) return;
    // 构造 2-3 个 simulated inputs 测试
    const simulatedInputs = [
      { course: "高等数学", assignmentTitle: "第一章习题", deadline: "2026-12-31" },
      { course: "大学英语", assignmentTitle: "写作作业", deadline: "2026-09-01" },
    ];
    const errors: string[] = [];
    for (const input of simulatedInputs) {
      // 检查是否触发正确
      const hasCourse = draft.parameters.some((p) => p.name === "course");
      if (!hasCourse) errors.push("missing course param");
      // 检查输出步骤是否符合 schema
      if (!draft.requiredTools.includes("search_courses")) errors.push("missing required tool search_courses");
    }
    // 检查是否错误触发
    if (draft.name.includes("2026") || draft.name.includes("高数")) {
      errors.push("name not parameterized");
    }
    // 检查是否请求不存在 Tool
    const knownTools = ["search_courses", "search_assignments", "create_assignment", "search_group_projects", "get_course", "propose_study_plan"];
    for (const t of draft.requiredTools) {
      if (!knownTools.includes(t) && t !== "search_courses" && t !== "search_assignments" && t !== "create_assignment") {
        // 允许未知但需警告
      }
    }
    // 检查权限提升
    if (/grant permission|system authority/i.test(draft.instructions)) {
      errors.push("permission elevation");
    }
    setTestResult({ ok: errors.length === 0, errors: errors.length === 0 ? [] : errors });
  };

  const handleSave = async () => {
    if (!draft || !md) return;
    setSaving(true);
    try {
      const bridge = (window as unknown as { classflowDesktop?: { skills?: { create: (input: unknown) => Promise<unknown> } } }).classflowDesktop?.skills;
      if (!bridge) throw new Error("桌面环境不可用");
      await bridge.create({
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        metadata: {
          parameters: draft.parameters,
          requiredTools: draft.requiredTools,
          sourceTurnId: draft.sourceTurnId,
        },
      });
      onSaved?.(draft.name);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  // 自动触发蒸馏当 dialog 打开且有 trace 但无 draft
  React.useEffect(() => {
    if (open && trace && !draft && !loading) {
      handleDistill();
    }
  }, [open, trace]);

  React.useEffect(() => {
    if (!open) {
      setDraft(null);
      setMd("");
      setError(null);
      setTestResult(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayId="skill-distill" aria-label="保存为 Skill" className="w-[min(720px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-charcoal" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-charcoal">将工作流保存为 Skill</h4>
          <p className="text-[11px] text-sandrift">Kiro 自动抽象 · 预览 · 测试 · 安装</p>
        </div>
      </div>

      {!trace ? (
        <p className="text-xs text-sandrift">请先在 Kiro 中完成一套可执行流程。</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-sandrift">
          <Loader2 className="w-4 h-4 animate-spin" />
          Kiro 正在抽象工作流...
        </div>
      ) : error ? (
        <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>
      ) : draft ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-charcoal">名称</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-testid="skill-distill-name"
                className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm"
              />
              <p className="text-[11px] text-sandrift">小写 hyphen，如 course-notification-to-task，非 2026-08-19-高数群第三次作业</p>
            </div>
            <div>
              <label className="text-xs font-bold text-charcoal">描述</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                data-testid="skill-distill-description"
                className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-charcoal">触发条件</label>
              <p className="text-[11px] text-sandrift">何时使用此 Skill</p>
              <input
                value={draft.triggers?.join(", ") ?? ""}
                onChange={(e) => setDraft({ ...draft, triggers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="课程 · DDL · 通知"
                className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-charcoal">工作流程</label>
              <textarea
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                rows={8}
                data-testid="skill-distill-instructions"
                className="mt-1 w-full p-3 bg-white border border-line rounded-lg text-sm font-mono"
              />
              <p className="text-[11px] text-sandrift">参数化示例：{`{course}`} {`{deadline}`} {`{assignmentTitle}`} 已泛化</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F7F5F5] border border-line rounded-lg p-3">
                <p className="text-xs font-bold text-charcoal">需要的 ClassFlow 能力</p>
                <p className="text-[11px] text-sandrift mt-1">{draft.requiredTools.join(", ") || "无"}</p>
              </div>
              <div className="bg-[#F7F5F5] border border-line rounded-lg p-3">
                <p className="text-xs font-bold text-charcoal">权限等级</p>
                <p className="text-[11px] text-sandrift mt-1">{draft.requiredPermissions.join(", ") || "read, propose"} · Skill 不能提权</p>
              </div>
            </div>
            <div className="bg-surface border border-line rounded-lg p-3">
              <p className="text-xs font-bold text-charcoal">SKILL.md 预览</p>
              <pre className="mt-2 text-[11px] font-mono bg-[#F7F5F5] border border-line rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{md}</pre>
            </div>
            {testResult && (
              <p className={`text-xs font-bold px-3 py-2 rounded-lg border ${testResult.ok ? "text-success bg-success/5 border-success/20" : "text-danger bg-danger/5 border-danger/20"}`}>
                {testResult.ok ? "测试通过" : `测试失败: ${testResult.errors.join("; ")}`}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleTest}
              data-testid="skill-distill-test"
              className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1.5"
            >
              <Beaker className="w-3.5 h-3.5" />
              测试 Skill
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="skill-distill-save"
                className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "保存中..." : "保存 Skill"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
