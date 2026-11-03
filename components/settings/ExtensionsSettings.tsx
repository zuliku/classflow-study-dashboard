"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, Puzzle, Boxes, Info, Pencil, Trash2, Upload, Download, BadgeCheck, Lock } from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useExtensionsStore } from "@/store/useExtensionsStore";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { SkillDistillDialog } from "@/components/kiro/SkillDistillDialog";
import { ChannelSettings } from "@/components/settings/ChannelSettings";
import { extractWorkflowTrace } from "@/lib/ai/skills/workflowTrace";
import { BUILTIN_SKILLS } from "@/lib/ai/skills/builtin";
import { useToastStore } from "@/store/useToastStore";
import { resolveChannelUserMessage } from "@/lib/channels/errorContract";
import { useConfirmStore } from "@/store/useConfirmStore";

type RuntimeLoadState = "loading" | "ready" | "unavailable" | "error";

type SkillListItem = {
  name: string;
  description: string;
  folderName: string;
  enabled: boolean;
  /** S1：canonical 分类 / 来源 */
  kind?: "workflow" | "recipe";
  origin?: "builtin" | "user";
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  legacyTriggers?: string[];
  requiredTools?: string[];
  lastUsedAt?: number;
};

function getSkillBridge(): {
  list: () => Promise<{ skills: SkillListItem[] }>;
  get: (input: { name: string }) => Promise<{ skill: SkillListItem & { instructions: string; rawContent: string; kiroManifest?: Record<string, unknown> } }>;
  create: (input: { name: string; description: string; instructions: string; license?: string; compatibility?: string; kiroManifest?: Record<string, unknown> }) => Promise<unknown>;
  update: (input: { name: string; description?: string; instructions?: string; license?: string; compatibility?: string; kiroManifest?: Record<string, unknown> }) => Promise<unknown>;
  delete: (input: { name: string }) => Promise<unknown>;
  setEnabled: (input: { name: string; enabled: boolean }) => Promise<unknown>;
  import: () => Promise<{ cancelled?: boolean; skill?: SkillListItem }>;
  export: (input: { name: string }) => Promise<{ content: string }>;
  test: (input: { name: string }) => Promise<{ ok: boolean; errors: string[] }>;
  activate: (input: { skillName: string }) => Promise<unknown>;
} | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { classflowDesktop?: { skills?: unknown } }).classflowDesktop?.skills as never;
  return bridge ?? null;
}

type McpConnectionItem = {
  config: { id: string; name: string; endpoint: string; credentialRef?: string; enabled: boolean };
  state: string;
  serverInfo?: { name: string; version: string };
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  error?: string;
};

function getMcpBridge(): {
  list: () => Promise<{ connections: McpConnectionItem[] }>;
  add: (input: { name: string; endpoint: string; credentialRef?: string }) => Promise<unknown>;
  test: (input: { endpoint: string; credentialRef?: string }) => Promise<{ ok: boolean; error?: string; serverInfo?: unknown }>;
  connect: (input: { id: string }) => Promise<unknown>;
  disconnect: (input: { id: string }) => Promise<unknown>;
  remove: (input: { id: string }) => Promise<unknown>;
  setEnabled: (input: { id: string; enabled: boolean }) => Promise<unknown>;
} | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { classflowDesktop?: { mcp?: unknown } }).classflowDesktop?.mcp as never;
  return bridge ?? null;
}

export function ExtensionsSettings() {
  const activeTab = useExtensionsStore((s) => s.activeTab);
  const setActiveTab = useExtensionsStore((s) => s.setActiveTab);

  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [skillsState, setSkillsState] = useState<RuntimeLoadState>("loading");
  const skillBridge = useMemo(() => getSkillBridge(), []);
  const [mcpConnections, setMcpConnections] = useState<McpConnectionItem[]>([]);
  const [mcpState, setMcpState] = useState<RuntimeLoadState>("loading");
  const mcpBridge = useMemo(() => getMcpBridge(), []);
  // 世代守卫：慢旧 list 回包不覆盖新态（删 skill 后闪回已删项）；连点重试只认最后一次
  const refreshGenRef = React.useRef(0);

  const refreshMcp = async () => {
    const gen = ++refreshGenRef.current;
    const bridge = getMcpBridge();
    if (!bridge) {
      if (refreshGenRef.current !== gen) return;
      setMcpConnections([]);
      setMcpState("unavailable");
      return;
    }
    setMcpState("loading");
    try {
      const res = (await bridge.list()) as { connections: McpConnectionItem[] };
      if (refreshGenRef.current !== gen) return;
      setMcpConnections(Array.isArray(res.connections) ? res.connections : []);
      setMcpState("ready");
    } catch {
      if (refreshGenRef.current !== gen) return;
      setMcpConnections([]);
      setMcpState("error");
    }
  };

  const refreshSkills = async () => {
    const gen = ++refreshGenRef.current;
    const bridge = getSkillBridge();
    if (!bridge) {
      if (refreshGenRef.current !== gen) return;
      setSkills([]);
      setSkillsState("unavailable");
      return;
    }
    setSkillsState("loading");
    try {
      const res = (await bridge.list()) as { skills: SkillListItem[] };
      if (refreshGenRef.current !== gen) return;
      setSkills(Array.isArray(res.skills) ? res.skills : []);
      setSkillsState("ready");
    } catch {
      if (refreshGenRef.current !== gen) return;
      setSkills([]);
      setSkillsState("error");
    }
  };

  useEffect(() => {
    refreshSkills();
  }, []);

  useEffect(() => {
    refreshMcp();
  }, []);

  // Channel summary truth source: real Channel runtime via desktop bridge
  const [channelStatuses, setChannelStatuses] = useState<Array<{ health: { state: string } }>>([]);
  const [channelState, setChannelState] = useState<RuntimeLoadState>("loading");
  useEffect(() => {
    let cancelled = false;
    const fetchChannels = async () => {
      const bridge = (window as unknown as { classflowDesktop?: { channels?: { list: () => Promise<{ channels: Array<{ health: { state: string } }> }> } } }).classflowDesktop?.channels;
      if (!bridge?.list) {
        if (!cancelled) { setChannelStatuses([]); setChannelState("unavailable"); }
        return;
      }
      try {
        const res = await bridge.list();
        if (!cancelled) {
          setChannelStatuses(Array.isArray(res.channels) ? res.channels : []);
          setChannelState("ready");
        }
      } catch {
        if (!cancelled) {
          setChannelStatuses([]);
          setChannelState("error");
        }
      }
    };
    fetchChannels();
    const id = window.setInterval(fetchChannels, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const counts = useMemo(() => {
    let skillsVal: number | undefined;
    let enabledSkillsVal: number | undefined;
    let skillsExact = "—";
    let mcpVal: number | undefined;
    let connectedMcpVal: number | undefined;
    let channelsVal: number | undefined;
    let onlineChannelsVal: number | undefined;
    let channelsExact = "—";

    if (skillsState === "ready") {
      const total = skills.length;
      const enabled = skills.filter((s) => s.enabled).length;
      skillsVal = total;
      enabledSkillsVal = enabled;
      skillsExact = `${enabled} 个 Skills 已启用`;
    }
    if (mcpState === "ready") {
      const total = mcpConnections.length;
      const connected = mcpConnections.filter((c) => c.state === "connected").length;
      mcpVal = total;
      connectedMcpVal = connected;
    }
    if (channelState === "ready") {
      const total = channelStatuses.length;
      const online = channelStatuses.filter((c) => c.health.state === "connected").length;
      channelsVal = total;
      onlineChannelsVal = online;
      channelsExact = `${online} 个消息渠道在线`;
    }

    // SummaryCard expects value=enabled/connected, total=total
    // For Skills card: value=enabledSkills, total=skills
    // For MCP: value=connectedMcp, total=mcp
    return {
      skills: skillsVal,
      enabledSkills: enabledSkillsVal,
      skillsExact,
      mcp: mcpVal,
      connectedMcp: connectedMcpVal,
      mcpExact: mcpState === "ready" ? `${connectedMcpVal} 个 MCP 已连接` : "—",
      channels: channelsVal,
      onlineChannels: onlineChannelsVal,
      channelsExact,
      skillsState,
      mcpState,
      channelState,
    };
  }, [skills, skillsState, mcpConnections, mcpState, channelStatuses, channelState]);

  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillListItem | null>(null);
  const [skillTestResult, setSkillTestResult] = useState<null | { ok: boolean; errors: string[] }>(null);
  const [workflowDistillOpen, setWorkflowDistillOpen] = useState(false);
  const [workflowTrace, setWorkflowTrace] = useState<import("@/lib/ai/skills/types").WorkflowTrace | null>(null);
  const [mcpAddOpen, setMcpAddOpen] = useState(false);
  const [mcpDetail, setMcpDetail] = useState<McpConnectionItem | null>(null);

  const handleSkillToggle = async (name: string, enabled: boolean) => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    try {
      await bridge.setEnabled({ name, enabled });
      await refreshSkills();
    } catch (e) {
      // 持久化失败必须可见（否则用户以为已切换，重启后回退）
      useToastStore.getState().pushToast({
        message: `切换「${name}」状态失败：${resolveChannelUserMessage(e, "请稍后重试")}`,
        type: "error",
      });
    }
  };

  const handleSkillDelete = async (name: string) => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    useConfirmStore.getState().confirm({
      title: `删除「${name}」？`,
      description: `确定删除 Skill "${name}"？此操作不可撤销。`,
      danger: true,
      confirmLabel: "删除",
      onConfirm: async () => {
        try {
          await bridge.delete({ name });
          await refreshSkills();
          useToastStore.getState().pushToast({ message: "已删除", type: "success" });
        } catch (e) {
          useToastStore.getState().pushToast({ message: `删除失败：${(e as { message?: string })?.message ?? String(e)}`, type: "error" });
        }
      },
    });
  };

  const handleSkillTest = async (name: string) => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    try {
      const res = (await bridge.test({ name })) as { ok: boolean; errors: string[] };
      setSkillTestResult(res);
      setTimeout(() => setSkillTestResult(null), 3000);
    } catch (e) {
      setSkillTestResult({ ok: false, errors: [(e as { message?: string })?.message ?? String(e)] });
    }
  };

  const handleSkillImport = async () => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    try {
      const res = (await bridge.import()) as { cancelled?: boolean };
      if (!res.cancelled) {
        await refreshSkills();
        useToastStore.getState().pushToast({ message: "已导入", type: "success" });
      }
    } catch (e) {
      useToastStore.getState().pushToast({ message: `导入失败：${(e as { message?: string })?.message ?? String(e)}`, type: "error" });
    }
  };

  const handleSkillExport = async (name: string) => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    try {
      const res = (await bridge.export({ name })) as { content: string };
      const blob = new Blob([res.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-SKILL.md`;
      a.click();
      URL.revokeObjectURL(url);
      useToastStore.getState().pushToast({ message: "已导出", type: "success" });
    } catch (e) {
      useToastStore.getState().pushToast({ message: `导出失败：${(e as { message?: string })?.message ?? String(e)}`, type: "error" });
    }
  };

  const openCreateSkill = () => {
    setEditingSkill(null);
    setSkillEditorOpen(true);
  };

  const openEditSkill = async (item: SkillListItem) => {
    const bridge = getSkillBridge();
    if (!bridge) {
      setEditingSkill(item);
      setSkillEditorOpen(true);
      return;
    }
    try {
      const res = (await bridge.get({ name: item.name })) as { skill: SkillListItem & { instructions: string } };
      setEditingSkill(res.skill as SkillListItem);
      setSkillEditorOpen(true);
    } catch {
      setEditingSkill(item);
      setSkillEditorOpen(true);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-extensions">
      <SettingsSection
        title="连接与扩展"
      >
        <div
          data-setting-id="extensions-overview"
          className="grid grid-cols-3 gap-2 text-center"
          data-testid="extensions-summary"
        >
          <SummaryCard label="Skills 已启用" value={counts.enabledSkills} total={counts.skills} exact={counts.skillsExact} />
          <SummaryCard label="MCP 已连接" value={counts.connectedMcp} total={counts.mcp} exact={counts.mcpExact} />
          <SummaryCard label="消息渠道在线" value={counts.onlineChannels} total={counts.channels} exact={counts.channelsExact} />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F7F5F5] border border-line rounded-xl w-fit" role="tablist" aria-label="扩展类型">
          <TabButton active={activeTab === "skills"} onClick={() => setActiveTab("skills")} icon={Puzzle} label="Skills" testId="extensions-tab-skills" />
          <TabButton active={activeTab === "mcp"} onClick={() => setActiveTab("mcp")} icon={Boxes} label="MCP" testId="extensions-tab-mcp" />
          <TabButton active={activeTab === "channels"} onClick={() => setActiveTab("channels")} icon={MessageSquare} label="消息渠道" testId="extensions-tab-channels" />
        </div>

        <div className={cn("space-y-3", activeTab === "skills" && "ux-page")} data-testid="extensions-skills-panel" data-setting-id="extensions-skills" hidden={activeTab !== "skills"}>
          <SettingsGroup
            title="Skills"
            action={
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={openCreateSkill} data-testid="extensions-create-skill">
                  <Plus className="w-3.5 h-3.5" />
                  创建 Skill
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSkillImport} data-testid="extensions-import-skill">
                  <Upload className="w-3.5 h-3.5" />
                  导入
                </Button>
              </div>
            }
            contentClassName="px-4 py-4"
          >

            {skillsState === "loading" ? (
              <p className="text-xs text-sandrift" data-testid="skills-loading">加载中...</p>
            ) : skillsState === "unavailable" ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8" data-testid="skills-unavailable">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Puzzle className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">当前环境无法读取 Skills</p>
                  <p className="text-xs text-sandrift mt-1 max-w-[320px]">Skills 管理仅在桌面版可用</p>
                </div>
              </div>
            ) : skillsState === "error" ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8" data-testid="skills-error">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Puzzle className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">暂时无法读取 Skills</p>
                  <p className="text-xs text-sandrift mt-1">请检查连接后重试</p>
                </div>
                <button type="button" onClick={refreshSkills} data-testid="skills-retry" className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle">重新加载</button>
              </div>
            ) : skills.length === 0 ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Puzzle className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">还没有 Skill</p>
                  <p className="text-xs text-sandrift mt-1 max-w-[340px]">
                    将重复流程保存为 Skill；也支持导入 SKILL.md。
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                  <Button variant="primary" size="sm" onClick={openCreateSkill}>
                    <Plus className="w-3.5 h-3.5" />
                    创建 Skill
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      // 尝试提取最近成功 workflow（若无则提示）
                      try {
                        const chatMessages = (window as unknown as { __kiroChatMessages?: unknown[] }).__kiroChatMessages;
                        if (Array.isArray(chatMessages) && chatMessages.length > 0) {
                          const trace = extractWorkflowTrace(chatMessages as never);
                          setWorkflowTrace(trace);
                        } else {
                          setWorkflowTrace(null);
                        }
                      } catch {
                        setWorkflowTrace(null);
                      }
                      setWorkflowDistillOpen(true);
                    }}
                    data-testid="extensions-create-from-workflow"
                  >
                    从 Kiro 工作流创建
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    data-testid={`skill-card-${skill.name}`}
                    className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-charcoal truncate">{skill.name}</h4>
                          <span
                            className={cn(
                              "shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold border",
                              skill.enabled ? "bg-success/10 text-success border-success/20" : "bg-[#F7F5F5] text-satin-grey border-line"
                            )}
                          >
                            {skill.enabled ? "已启用" : "已停用"}
                          </span>
                        </div>
                        <p className="text-xs text-sandrift mt-1 leading-relaxed line-clamp-2">{skill.description}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-sandrift">
                          {skill.kind === "recipe" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#F7F5F5] border border-line rounded-full">
                              本机配方
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-surface-soft border border-line rounded-full text-sandrift">
                              工作流 Skill
                            </span>
                          )}
                          {skill.compatibility && <span className="px-2 py-1 bg-alabaster border border-line rounded-full">{skill.compatibility}</span>}
                          {skill.lastUsedAt && (
                            <span>最近使用 {new Date(skill.lastUsedAt).toLocaleDateString("zh-CN")}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant={skill.enabled ? "secondary" : "primary"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => handleSkillToggle(skill.name, !skill.enabled)}
                        data-testid={`skill-toggle-${skill.name}`}
                        aria-label={skill.enabled ? `停用 ${skill.name}` : `启用 ${skill.name}`}
                      >
                        {skill.enabled ? "停用" : "启用"}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-line-soft">
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSkillTest(skill.name)}
                          data-testid={`skill-test-${skill.name}`}
                        >
                          <BadgeCheck className="w-3 h-3" />
                          检查
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditSkill(skill)}
                          data-testid={`skill-edit-${skill.name}`}
                        >
                          <Pencil className="w-3 h-3" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSkillExport(skill.name)}
                          data-testid={`skill-export-${skill.name}`}
                        >
                          <Download className="w-3 h-3" />
                          导出
                        </Button>
                      </div>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSkillDelete(skill.name)}
                        data-testid={`skill-delete-${skill.name}`}
                        className="text-sandrift hover:text-danger"
                        aria-label={`删除 Skill ${skill.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                    {skillTestResult && (
                      <p className={cn("text-[11px] font-bold", skillTestResult.ok ? "text-success" : "text-danger")}>
                        {skillTestResult.ok ? "检查通过" : `检查未通过：${skillTestResult.errors.join("；")}`}
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-sandrift flex items-start gap-1.5 px-1 leading-relaxed">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    在 Kiro 输入{" "}
                    <code className="px-1 py-0.5 bg-[#F7F5F5] border border-line rounded text-charcoal font-mono">/skill-name</code>{" "}
                    可直接调用，或描述任务让 Kiro 选择 Skill。
                  </span>
                </p>
              </div>
            )}
          </SettingsGroup>

          {/* 内置 Skills：随应用打包、无需配置；锁定展示（不可编辑/停用/删除） */}
          <SettingsGroup
            title="内置 Skills"
            contentClassName="px-4 py-4"
          >
            <div className="space-y-2" data-testid="builtin-skills">
              {BUILTIN_SKILLS.map((skill) => (
                <div
                  key={skill.name}
                  data-testid={`skill-card-${skill.name}`}
                  className="bg-[#FAF9F8] border border-line rounded-xl px-4 py-3 flex items-start gap-3"
                >
                  <span className="w-7 h-7 rounded-lg bg-pastel-mint/60 border border-line flex items-center justify-center shrink-0">
                    <Lock className="w-3.5 h-3.5 text-charcoal" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-[13px] font-bold text-charcoal truncate">{skill.name}</h4>
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border bg-white text-satin-grey border-line">
                        内置
                      </span>
                    </div>
                    <p className="text-xs text-sandrift leading-relaxed mt-0.5">{skill.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </SettingsGroup>
        </div>

        <div className={cn("space-y-3", activeTab === "mcp" && "ux-page")} data-testid="extensions-mcp-panel" data-setting-id="extensions-mcp" hidden={activeTab !== "mcp"}>
          <SettingsGroup
            title="MCP"
            description="连接外部工具与数据服务。"
            action={
              <button
                type="button"
                onClick={() => setMcpAddOpen(true)}
                data-testid="extensions-add-mcp"
                className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                添加 MCP
              </button>
            }
            contentClassName="px-4 py-4"
          >
            {mcpState === "loading" ? (
              <p className="text-xs text-sandrift" data-testid="mcp-loading">加载中...</p>
            ) : mcpState === "unavailable" ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8" data-testid="mcp-unavailable">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">当前环境无法读取 MCP</p>
                  <p className="text-xs text-sandrift mt-1 max-w-[320px]">MCP 管理在桌面环境中可用</p>
                </div>
              </div>
            ) : mcpState === "error" ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8" data-testid="mcp-error">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">暂时无法读取 MCP</p>
                  <p className="text-xs text-sandrift mt-1">请检查连接后重试</p>
                </div>
                <button type="button" onClick={refreshMcp} data-testid="mcp-retry" className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle">重新加载</button>
              </div>
            ) : mcpConnections.length === 0 ? (
              <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">还没有 MCP 连接</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {mcpConnections.map((conn) => (
                  <div key={conn.config.id} data-testid={`mcp-card-${conn.config.id}`} className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-charcoal truncate">{conn.config.name} MCP</h4>
                          <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold border", conn.state === "connected" ? "bg-success/10 text-success border-success/20" : conn.state === "error" ? "bg-danger/10 text-danger border-danger/20" : "bg-[#F7F5F5] text-satin-grey border-line")}>
                            {conn.state === "connected" ? "● 已连接" : conn.state === "connecting" ? "连接中" : conn.state === "error" ? "错误" : "未连接"}
                          </span>
                        </div>
                        <p className="text-xs text-sandrift mt-1 truncate">{conn.config.endpoint}</p>
                        <p className="text-[11px] text-sandrift mt-1">
                          {conn.toolCount} 个工具 · {conn.resourceCount} 个资源 {conn.serverInfo?.name ? `· ${conn.serverInfo.name}` : ""}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-[11px]">
                          <span className="px-2 py-1 bg-[#F7F5F5] border border-line rounded-full">Kiro 使用 {conn.config.enabled ? "已允许" : "已禁用"}</span>
                          <span className="px-2 py-1 bg-alabaster border border-line rounded-full">可能修改数据的操作会先询问</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => setMcpDetail(conn)} data-testid={`mcp-manage-${conn.config.id}`} className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster">管理</button>
                    </div>
                    {conn.error && <p className="text-[11px] text-danger">{conn.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </SettingsGroup>
        </div>

        <div className={cn("space-y-3", activeTab === "channels" && "ux-page")} data-testid="extensions-channels-panel" data-setting-id="extensions-channels" hidden={activeTab !== "channels"}>
          <ChannelSettings />
        </div>
      </SettingsSection>

      <SkillEditorDialog
        open={skillEditorOpen}
        onOpenChange={setSkillEditorOpen}
        editingSkill={editingSkill}
        onSaved={refreshSkills}
      />
      <SkillDistillDialog
        open={workflowDistillOpen}
        onOpenChange={setWorkflowDistillOpen}
        trace={workflowTrace}
        onSaved={(name) => {
          refreshSkills();
          setWorkflowDistillOpen(false);
        }}
      />
      <McpAddDialog open={mcpAddOpen} onOpenChange={setMcpAddOpen} onAdded={refreshMcp} />
      <McpDetailDialog connection={mcpDetail} onOpenChange={(open) => !open && setMcpDetail(null)} onRefresh={refreshMcp} />
    </div>
  );
}

function McpAddDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [testResult, setTestResult] = useState<null | { ok: boolean; serverInfo?: unknown; error?: string }>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    if (!endpoint) {
      setError("Endpoint 必填");
      return;
    }
    const bridge = getMcpBridge();
    if (!bridge) {
      setError("桌面环境不可用");
      return;
    }
    try {
      const res = (await bridge.test({ endpoint, credentialRef: credentialRef || undefined })) as { ok: boolean; serverInfo?: unknown; error?: string };
      setTestResult(res);
      if (!res.ok) setError(res.error ?? "连接失败");
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  const handleSave = async () => {
    setError(null);
    if (!name || !endpoint) {
      setError("名称和 Endpoint 必填");
      return;
    }
    const bridge = getMcpBridge();
    if (!bridge) {
      setError("桌面环境不可用");
      return;
    }
    setSaving(true);
    try {
      await bridge.add({ name, endpoint, credentialRef: credentialRef || undefined });
      onAdded();
      onOpenChange(false);
      setName("");
      setEndpoint("");
      setCredentialRef("");
      setTestResult(null);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.message ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayId="mcp-add" aria-label="添加 MCP" className="w-[min(520px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
          <Boxes className="w-4 h-4 text-charcoal" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-charcoal">添加 MCP</h4>
          <p className="text-[11px] text-sandrift">支持远程 MCP 服务</p>
        </div>
      </div>
      <div className="space-y-3">
        <Field label="名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notion MCP" data-testid="mcp-add-name" />
        </Field>
        <Field label="Endpoint" required description="默认使用 https">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://mcp.example.com/mcp" data-testid="mcp-add-endpoint" mono />
        </Field>
        <Field label="凭据" description="如需认证，请先在凭据管理中创建后填入引用">
          <Input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="cred_xxx（可选）" data-testid="mcp-add-credential" mono />
        </Field>
        {testResult && (
          <div className={`text-xs font-bold px-3 py-2 rounded-lg border ${testResult.ok ? "text-success bg-success/5 border-success/20" : "text-danger bg-danger/5 border-danger/20"}`}>
            {testResult.ok ? `连接成功${testResult.serverInfo ? ` · ${(testResult.serverInfo as { name?: string })?.name ?? ""}` : ""}` : `测试失败: ${testResult.error}`}
            {testResult.ok && (testResult as { tools?: unknown[] }).tools && <p className="text-[11px] font-normal mt-1">{(testResult as { tools?: unknown[] }).tools?.length ?? 0} 个工具已发现</p>}
          </div>
        )}
        {error && <InlineErrorState>{error}</InlineErrorState>}
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleTest} data-testid="mcp-test">测试连接</Button>
          <div className="flex-1" />
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSave} loading={saving} loadingLabel="保存中…" data-testid="mcp-save">保存</Button>
        </div>
      </div>
    </Dialog>
  );
}

function McpDetailDialog({ connection, onOpenChange, onRefresh }: { connection: McpConnectionItem | null; onOpenChange: (open: boolean) => void; onRefresh: () => void }) {
  const open = !!connection;
  const handleAction = async (action: "connect" | "disconnect" | "remove" | "toggle") => {
    if (!connection) return;
    const bridge = getMcpBridge();
    if (!bridge) return;
    if (action === "remove") {
      useConfirmStore.getState().confirm({
        title: `删除「${connection.config.name}」？`,
        description: `确定删除 MCP "${connection.config.name}"？删除后无法恢复。`,
        danger: true,
        confirmLabel: "删除",
        onConfirm: async () => {
          try {
            await bridge.remove({ id: connection.config.id });
            onRefresh();
            onOpenChange(false);
            useToastStore.getState().pushToast({ message: "已删除", type: "success" });
          } catch (e) {
            useToastStore.getState().pushToast({ message: (e as Error).message ?? String(e), type: "error" });
          }
        },
      });
      return;
    }
    try {
      if (action === "connect") await bridge.connect({ id: connection.config.id });
      if (action === "disconnect") await bridge.disconnect({ id: connection.config.id });
      if (action === "toggle") await bridge.setEnabled({ id: connection.config.id, enabled: !connection.config.enabled });
      onRefresh();
      useToastStore.getState().pushToast({ message: action === "connect" ? "已连接" : action === "disconnect" ? "已断开" : "已更新", type: "success" });
    } catch (e) {
      useToastStore.getState().pushToast({ message: (e as Error).message ?? String(e), type: "error" });
    }
  };

  if (!connection) return <Dialog open={false} onOpenChange={onOpenChange} overlayId="mcp-detail" aria-label="MCP 详情" className="w-[min(520px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5" />;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayId="mcp-detail" aria-label="MCP 详情" className="w-[min(560px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
          <Boxes className="w-4 h-4 text-charcoal" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-charcoal">{connection.config.name}</h4>
          <p className="text-[11px] text-sandrift">{connection.config.endpoint} · {connection.state}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface-soft border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.toolCount}</p>
          <p className="text-[11px] text-sandrift">工具</p>
        </div>
        <div className="bg-surface-soft border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.resourceCount}</p>
          <p className="text-[11px] text-sandrift">资源</p>
        </div>
        <div className="bg-surface-soft border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.promptCount}</p>
          <p className="text-[11px] text-sandrift">提示</p>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <p><span className="font-bold">连接信息：</span>{connection.config.endpoint}</p>
        <p><span className="font-bold">凭据：</span>{connection.config.credentialRef ? `已配置` : "无 (公开)"}</p>
        <p><span className="font-bold">权限：</span>可能修改数据的操作会先询问</p>
        {connection.serverInfo && <p><span className="font-bold">Server：</span>{connection.serverInfo.name} {connection.serverInfo.version}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {connection.state !== "connected" ? (
          <Button type="button" variant="primary" size="sm" onClick={() => handleAction("connect")} data-testid="mcp-connect">连接</Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => handleAction("disconnect")} data-testid="mcp-disconnect">断开</Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => handleAction("toggle")} data-testid="mcp-toggle">{connection.config.enabled ? "停用" : "启用"}</Button>
        <Button type="button" variant="danger" size="sm" onClick={() => handleAction("remove")} data-testid="mcp-remove">删除</Button>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
      </div>
    </Dialog>
  );
}

function SummaryCard({ label, value, total, exact }: { label: string; value?: number; total?: number; exact: string }) {
  const showSkeleton = value === undefined || total === undefined;
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-3 flex flex-col items-center justify-center gap-1 min-h-[64px]">
      <span className="text-sm font-bold text-charcoal" data-testid={`summary-${label}`}>{exact}</span>
      <span className="text-[11px] font-medium text-sandrift">
        {showSkeleton ? "—" : `${value} / ${total}`}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors",
        active
          ? "bg-charcoal text-white shadow-subtle"
          : "text-satin-grey hover:bg-white hover:text-charcoal border border-transparent hover:border-line"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function SkillEditorDialog({
  open,
  onOpenChange,
  editingSkill,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSkill: SkillListItem | null;
  onSaved: () => void;
}) {
  const isEdit = !!editingSkill;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [license, setLicense] = useState("");
  const [compatibility, setCompatibility] = useState("");
  const [permissionsNote, setPermissionsNote] = useState("Skill cannot elevate permissions. Skill instructions provide workflow guidance only.");
  /** S1：编辑时保留既有 structured Kiro metadata（只更新 requiredTools） */
  const [existingManifest, setExistingManifest] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingSkill) {
        setName(editingSkill.name);
        setDescription(editingSkill.description);
        setWorkflow("");
        setCapabilities((editingSkill.requiredTools ?? []).join(", "));
        setLicense(editingSkill.license ?? "");
        setCompatibility(editingSkill.compatibility ?? "");
        setPermissionsNote("Skill cannot elevate permissions.");
        const bridge = getSkillBridge();
        if (bridge) {
          bridge
            .get({ name: editingSkill.name })
            .then((res) => {
              const skill = (res as { skill: { instructions?: string; kiroManifest?: Record<string, unknown> } }).skill;
              if (skill?.instructions) setWorkflow(skill.instructions);
              setExistingManifest(skill?.kiroManifest ?? null);
            })
            // 读取失败必须可见：静默会让用户基于空模板覆盖保存，丢掉原 Skill 内容
            .catch(() => {
              setError("读取 Skill 失败，工作流为空；请关闭后重试，保存前确认内容完整。");
            });
        }
      } else {
        setName("");
        setDescription("");
        setWorkflow(`# Workflow\n\n1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`);
        setCapabilities("");
        setLicense("");
        setCompatibility("");
        setExistingManifest(null);
        setPermissionsNote("Skill cannot elevate permissions. Skill instructions provide workflow guidance only and do not grant system authority.");
      }
      setError(null);
    }
  }, [open, editingSkill]);

  const handleSave = async () => {
    setError(null);
    if (!name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.trim())) {
      setError("名称必须为小写字母/数字/连字符，且符合 skill-name 规范");
      return;
    }
    if (!description.trim()) {
      setError("描述必填");
      return;
    }
    if (!workflow.trim()) {
      setError("工作流程不能为空");
      return;
    }
    const bridge = getSkillBridge();
    if (!bridge) {
      setError("桌面环境不可用，无法保存 Skill");
      return;
    }
    setSaving(true);
    try {
      const requiredTools = capabilities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // S1：structured Kiro metadata 走 agents/kiro.json（绝不写入 SKILL.md metadata）
      const kiroManifest = {
        version: 1,
        kind: (existingManifest?.kind as string) === "recipe" ? "recipe" : "workflow",
        requiredTools,
        requiredPermissions: (existingManifest?.requiredPermissions as string[]) ?? [],
        requiredCapabilities: (existingManifest?.requiredCapabilities as string[]) ?? [],
        parameters: (existingManifest?.parameters as unknown[]) ?? [],
        sourceTurnId: (existingManifest?.sourceTurnId as string) ?? "",
      };
      const payload = {
        name: name.trim(),
        description: description.trim(),
        instructions: workflow.trim(),
        license: license.trim() || undefined,
        compatibility: compatibility.trim() || undefined,
        kiroManifest,
      };
      if (isEdit) {
        await bridge.update(payload);
      } else {
        await bridge.create(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      try {
        const parsed = JSON.parse((e as Error).message);
        setError(parsed.message ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayId="extensions-skill-editor" aria-label={isEdit ? "编辑 Skill" : "创建 Skill"} className="w-[min(640px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
          <Puzzle className="w-4 h-4 text-charcoal" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-charcoal">{isEdit ? "编辑 Skill" : "创建 Skill"}</h4>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="名称" required description="小写字母/数字/连字符，唯一，需与文件夹名一致">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
            placeholder="course-notification"
            data-testid="skill-editor-name"
          />
        </Field>
        <Field label="描述" required>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="将课程通知整理为任务、DDL 与调课建议。"
            data-testid="skill-editor-description"
          />
        </Field>
        <Field label="工作流程" required description="Markdown">
          <Textarea
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            placeholder={`1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`}
            data-testid="skill-editor-workflow"
            rows={8}
            className="font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="需要的工具" description="逗号分隔的 Tool 名（仅诊断，不授权）。">
            <Input
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="get_week_schedule, propose_study_plan"
              data-testid="skill-editor-capabilities"
            />
          </Field>
          <Field label="兼容性">
            <Input
              value={compatibility}
              onChange={(e) => setCompatibility(e.target.value)}
              placeholder="windows"
              data-testid="skill-editor-compatibility"
            />
          </Field>
        </div>
        <Field label="许可">
          <Input
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            placeholder="MIT"
            data-testid="skill-editor-license"
          />
        </Field>
        <Field label="权限说明" description="Skill 不能提权，仅提供工作流指引">
          <p className="text-[11px] text-sandrift leading-relaxed" data-testid="skill-editor-permissions">
            {permissionsNote}
          </p>
        </Field>
        {error && (
          <InlineErrorState testid="skill-editor-error">
            {error}
          </InlineErrorState>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const bridge = getSkillBridge();
              if (!bridge || !name) return;
              try {
                const res = (await bridge.test({ name })) as { ok: boolean; errors: string[] };
                setError(res.ok ? "检查通过" : `检查未通过：${res.errors.join("；")}`);
              } catch (e) {
                setError(`检查未通过：${(e as { message?: string })?.message ?? String(e)}`);
              }
            }}
            data-testid="skill-editor-test"
          >
            <BadgeCheck className="w-3.5 h-3.5" />
            检查
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              loading={saving}
              loadingLabel="保存中…"
              data-testid="skill-editor-save"
            >
              {isEdit ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
