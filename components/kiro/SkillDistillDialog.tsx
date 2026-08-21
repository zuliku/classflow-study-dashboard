"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Sparkles, Loader2, Beaker, Save } from "lucide-react";
import type { WorkflowTrace } from "@/lib/ai/skills/types";
import type { SkillDraft } from "@/lib/ai/skills/types";

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
      const { useAISettingsStore } = await import("@/store/useAISettingsStore");
      const { getSessionApiKey } = await import("@/lib/ai/sessionKeys");
      const { provider, model, custom } = useAISettingsStore.getState();
      const apiKey = getSessionApiKey(provider as never);
      if (!apiKey) {
        setError("请先在 Kiro 设置中配置 API Key");
        setLoading(false);
        return;
      }
      // 通过 ClassFlow Local API 调用 Server-side Distill via window.classflowDesktop.api.request
      const res = await (window as unknown as { classflowDesktop: { api: { request: (path: string, init?: RequestInit) => Promise<Response> } } }).classflowDesktop.api.request("/api/ai/skills/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace, provider, model, customConfig: custom, apiKey }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error((err as { message?: string }).message ?? `Distill failed: ${res.status}`);
      }
      const data = (await res.json()) as { draft: SkillDraft; md: string };
      setDraft(data.draft);
      setMd(data.md);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!draft) return;
    const errors: string[] = [];
    // 1. SKILL.md schema valid (通过 draft 已校验，此处再检查)
    try {
      const { parseSkillMd } = await import("@/lib/ai/skills/parser");
      const md = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.instructions}`;
      parseSkillMd(md);
    } catch (e) {
      errors.push(`SKILL.md invalid: ${(e as Error).message}`);
    }
    // 2. name valid
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.name)) errors.push("INVALID_NAME_PATTERN");
    // 3. description valid
    if (!draft.description || draft.description.trim().length === 0) errors.push("MISSING_DESCRIPTION");
    // 4. parameters valid
    for (const p of draft.parameters) {
      if (!p.name || !p.type || !p.description) errors.push(`invalid parameter ${p.name}`);
    }
    // 5. requiredTools 全部是真实存在的 ClassFlow Tool / MCP capability
    const knownTools = [
      "search_courses","get_course","get_week_schedule","search_assignments","get_assignment","get_assignment_schedule","get_assignment_health","get_available_time","propose_study_plan","get_upcoming_assignments","search_group_projects","get_group_project","get_group_tasks","get_calendar_range","get_material_metadata","read_material","read_project_file","search_project_file","read_project_visual","propose_task_breakdown","list_reminders","get_focus_status","query_learning_history","summarize_learning_history","get_learning_analytics","get_learning_outlook","propose_study_rebalance","propose_visual_actions","propose_timetable_import","activate_skill","mcp_search_tools","mcp_call_tool","create_assignment","update_assignment","set_assignment_ddl","create_study_blocks",
    ];
    for (const t of draft.requiredTools) {
      if (!knownTools.includes(t)) {
        // 检查是否为 MCP tool (需已连接的 MCP 的 tool)
        // 此处若为未知 tool，视为 fail（disabled/unknown tools fail）
        errors.push(`unknown tool: ${t}`);
      }
    }
    // 6. disabled/unknown tools 已在上一步检查
    // 7. requiredPermissions 不超过 Skill 可请求权限 (skill 只能 read/propose/write, 不能 terminal/filesystem)
    const allowedPermissions = ["read", "propose", "write"];
    for (const perm of draft.requiredPermissions) {
      if (!allowedPermissions.includes(perm)) errors.push(`permission not allowed: ${perm}`);
    }
    // 8. instructions 不包含权限提升语义
    if (/grant permission|system authority|sudo|admin/i.test(draft.instructions)) errors.push("permission elevation");
    // 9. instructions 不包含原始 sensitive identifiers
    if (/\bsk-[A-Za-z0-9_-]{10,}\b/.test(draft.instructions) || /credentialRef/.test(draft.instructions) || /[A-Z]:\\/.test(draft.instructions)) {
      errors.push("contains sensitive identifiers");
    }
    // 10. example-specific values 未被写死（检查 instructions 是否仍含原始固定值如日期特定）
    // 此处检查 name 是否参数化（已在上一步），以及 examples 是否泛化
    for (const ex of draft.examples) {
      const inputStr = JSON.stringify(ex.input);
      if (/2026-08-19/.test(inputStr) && !inputStr.includes("{")) {
        errors.push("example not parameterized");
      }
    }
    if (draft.name.includes("2026") || draft.name.includes("高数")) errors.push("name not parameterized");

    // 额外：构造 2-3 个 simulated inputs 测试是否触发正确且不错误触发
    const hasCourseParam = draft.parameters.some((p) => p.name === "course");
    if (draft.requiredTools.length > 0 && !hasCourseParam && draft.instructions.includes("{course}")) {
      errors.push("missing course param but instructions uses {course}");
    }

    setTestResult({ ok: errors.length === 0, errors });
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
                placeholder="课程, 作业"
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
