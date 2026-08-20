"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plug2, Wrench, MessageSquare, Plus, Puzzle, Boxes, ExternalLink, Info, Pencil, Trash2, Upload, Download, Beaker } from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useExtensionsStore } from "@/store/useExtensionsStore";
import { listChannelProviders } from "@/lib/extensions/registry";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { SkillDistillDialog } from "@/components/kiro/SkillDistillDialog";
import { ChannelSettings } from "@/components/settings/ChannelSettings";
import { extractWorkflowTrace } from "@/lib/ai/skills/workflowTrace";
import { useKiroRuntime } from "@/components/kiro/KiroSessionProvider";

type SkillListItem = {
  name: string;
  description: string;
  folderName: string;
  enabled: boolean;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  triggers?: string[];
  lastUsedAt?: number;
};

function getSkillBridge(): {
  list: () => Promise<{ skills: SkillListItem[] }>;
  get: (input: { name: string }) => Promise<{ skill: SkillListItem & { instructions: string; rawContent: string } }>;
  create: (input: { name: string; description: string; instructions: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
  update: (input: { name: string; description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
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
  const extensions = useExtensionsStore((s) => s.extensions);
  const activeTab = useExtensionsStore((s) => s.activeTab);
  const setActiveTab = useExtensionsStore((s) => s.setActiveTab);

  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const skillBridge = useMemo(() => getSkillBridge(), []);
  const [mcpConnections, setMcpConnections] = useState<McpConnectionItem[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const mcpBridge = useMemo(() => getMcpBridge(), []);

  const refreshMcp = async () => {
    const bridge = getMcpBridge();
    if (!bridge) {
      setMcpLoading(false);
      return;
    }
    try {
      const res = (await bridge.list()) as { connections: McpConnectionItem[] };
      setMcpConnections(Array.isArray(res.connections) ? res.connections : []);
    } catch {
      setMcpConnections([]);
    } finally {
      setMcpLoading(false);
    }
  };

  const refreshSkills = async () => {
    const bridge = getSkillBridge();
    if (!bridge) {
      setSkillsLoading(false);
      return;
    }
    try {
      const res = (await bridge.list()) as { skills: SkillListItem[] };
      setSkills(Array.isArray(res.skills) ? res.skills : []);
    } catch {
      setSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    refreshSkills();
  }, []);

  useEffect(() => {
    refreshMcp();
  }, []);

  const counts = useMemo(() => {
    if (skillBridge || mcpBridge) {
      const enabledSkills = skills.filter((s) => s.enabled).length;
      const mcpCount = mcpConnections.length;
      const connectedMcp = mcpConnections.filter((c) => c.state === "connected").length;
      return {
        skills: skills.length || extensions.filter((e) => e.kind === "skill").length,
        enabledSkills: enabledSkills || extensions.filter((e) => e.kind === "skill" && e.enabled).length,
        mcp: mcpCount || extensions.filter((e) => e.kind === "mcp").length,
        connectedMcp: connectedMcp || extensions.filter((e) => e.kind === "mcp" && e.status === "connected").length,
        channels: extensions.filter((e) => e.kind === "channel").length,
        onlineChannels: extensions.filter((e) => e.kind === "channel" && e.status === "connected").length,
      };
    }
    const skillsCount = extensions.filter((e) => e.kind === "skill").length;
    const enabledSkills = extensions.filter((e) => e.kind === "skill" && e.enabled).length;
    const mcp = extensions.filter((e) => e.kind === "mcp").length;
    const connectedMcp = extensions.filter((e) => e.kind === "mcp" && e.status === "connected").length;
    const channels = extensions.filter((e) => e.kind === "channel").length;
    const onlineChannels = extensions.filter((e) => e.kind === "channel" && e.status === "connected").length;
    if (skillBridge && !skillsLoading) {
      return {
        skills: skills.length,
        enabledSkills: skills.filter((s) => s.enabled).length,
        mcp,
        connectedMcp,
        channels,
        onlineChannels,
      };
    }
    return { skills: skillsCount, enabledSkills, mcp, connectedMcp, channels, onlineChannels };
  }, [extensions, skills, skillBridge, skillsLoading]);

  const channelProviders = listChannelProviders();

  const [providerDetail, setProviderDetail] = useState<null | { id: string; name: string }>(null);
  const [mcpPlaceholderOpen, setMcpPlaceholderOpen] = useState(false);
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
    } catch {}
  };

  const handleSkillDelete = async (name: string) => {
    const bridge = getSkillBridge();
    if (!bridge) return;
    if (!confirm(`确定删除 Skill "${name}"？此操作不可撤销。`)) return;
    try {
      await bridge.delete({ name });
      await refreshSkills();
    } catch (e) {
      alert(`删除失败：${(e as { message?: string })?.message ?? String(e)}`);
    }
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
      if (!res.cancelled) await refreshSkills();
    } catch (e) {
      alert(`导入失败：${(e as { message?: string })?.message ?? String(e)}`);
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
    } catch (e) {
      alert(`导出失败：${(e as { message?: string })?.message ?? String(e)}`);
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
        description="让 Kiro 使用你的工作流、外部工具与消息来源。"
      >
        <div
          data-setting-id="extensions-overview"
          className="grid grid-cols-3 gap-2 text-center"
          data-testid="extensions-summary"
        >
          <SummaryCard label="Skills 已启用" value={counts.enabledSkills} total={counts.skills} exact={`${counts.enabledSkills} 个 Skills 已启用`} />
          <SummaryCard label="MCP 已连接" value={counts.connectedMcp} total={counts.mcp} exact={`${counts.connectedMcp} 个 MCP 已连接`} />
          <SummaryCard label="消息渠道在线" value={counts.onlineChannels} total={counts.channels} exact={`${counts.onlineChannels} 个消息渠道在线`} />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F7F5F5] border border-line rounded-xl w-fit" role="tablist" aria-label="扩展类型">
          <TabButton active={activeTab === "skills"} onClick={() => setActiveTab("skills")} icon={Puzzle} label="Skills" testId="extensions-tab-skills" />
          <TabButton active={activeTab === "mcp"} onClick={() => setActiveTab("mcp")} icon={Boxes} label="MCP" testId="extensions-tab-mcp" />
          <TabButton active={activeTab === "channels"} onClick={() => setActiveTab("channels")} icon={MessageSquare} label="消息渠道" testId="extensions-tab-channels" />
        </div>

        <div className="space-y-3" data-testid="extensions-skills-panel" data-setting-id="extensions-skills" hidden={activeTab !== "skills"}>
          <SettingsGroup title="Skills" description="将常用的 Kiro 工作流程保存为可复用能力。">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateSkill}
                  data-testid="extensions-create-skill"
                  className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  创建 Skill
                </button>
                <button
                  type="button"
                  onClick={handleSkillImport}
                  data-testid="extensions-import-skill"
                  className="h-8 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  导入
                </button>
              </div>
              <span className="text-[11px] text-sandrift">{skills.length} 个 Skills · {skills.filter((s) => s.enabled).length} 已启用</span>
            </div>

            {!skillsLoading && skills.length === 0 ? (
              <div className="p-6 flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Puzzle className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">还没有 Skill</p>
                  <p className="text-xs text-sandrift mt-1 max-w-[320px]">将常用的 Kiro 工作流程保存为可复用能力，随时复用。支持 SKILL.md 兼容格式。</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={openCreateSkill}
                    className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    创建 Skill
                  </button>
                  <button
                    type="button"
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
                    className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1.5"
                  >
                    从 Kiro 工作流创建
                  </button>
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
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#F7F5F5] border border-line rounded-full">
                            自动触发 · {skill.triggers?.join(" · ") ?? "课程 · DDL · 通知"}
                          </span>
                          {skill.compatibility && <span className="px-2 py-1 bg-alabaster border border-line rounded-full">{skill.compatibility}</span>}
                        </div>
                        {skill.lastUsedAt && (
                          <p className="text-[11px] text-sandrift mt-1">最近使用 {new Date(skill.lastUsedAt).toLocaleDateString("zh-CN")}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSkillToggle(skill.name, !skill.enabled)}
                          data-testid={`skill-toggle-${skill.name}`}
                          className={cn(
                            "h-7 px-3 text-xs font-bold rounded-lg border transition-colors",
                            skill.enabled ? "bg-white text-charcoal border-line hover:bg-alabaster" : "bg-charcoal text-white border-charcoal hover:bg-black"
                          )}
                        >
                          {skill.enabled ? "停用" : "启用"}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-line-soft">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSkillTest(skill.name)}
                          data-testid={`skill-test-${skill.name}`}
                          className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1"
                        >
                          <Beaker className="w-3 h-3" />
                          测试
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditSkill(skill)}
                          data-testid={`skill-edit-${skill.name}`}
                          className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1"
                        >
                          <Pencil className="w-3 h-3" />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSkillExport(skill.name)}
                          data-testid={`skill-export-${skill.name}`}
                          className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          导出
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleSkillDelete(skill.name)}
                          data-testid={`skill-delete-${skill.name}`}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-danger transition-colors"
                          aria-label="删除 Skill"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {skillTestResult && (
                      <p className={cn("text-[11px] font-bold", skillTestResult.ok ? "text-success" : "text-danger")}>
                        {skillTestResult.ok ? "测试通过" : `测试失败: ${skillTestResult.errors.join("; ")}`}
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-sandrift flex items-center gap-1.5 px-1">
                  <Info className="w-3.5 h-3.5" />
                  在 Kiro 输入 <code className="px-1 py-0.5 bg-[#F7F5F5] border border-line rounded text-charcoal font-mono">/skill-name</code> 可显式调用已启用 Skill（仅显示 enabled）
                </p>
              </div>
            )}
          </SettingsGroup>
        </div>

        <div className="space-y-3" data-testid="extensions-mcp-panel" data-setting-id="extensions-mcp" hidden={activeTab !== "mcp"}>
          <SettingsGroup title="MCP" description="连接外部工具和数据服务，让 Kiro 在需要时调用。">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setMcpAddOpen(true)}
                data-testid="extensions-add-mcp"
                className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                添加 MCP
              </button>
              <span className="text-[11px] text-sandrift">{mcpConnections.length} 个 MCP · {mcpConnections.filter((c) => c.state === "connected").length} 已连接</span>
            </div>
            {mcpLoading ? (
              <p className="text-xs text-sandrift">加载中...</p>
            ) : mcpConnections.length === 0 ? (
              <div className="p-6 flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                  <p className="text-sm font-bold text-charcoal">还没有 MCP 连接</p>
                  <p className="text-xs text-sandrift mt-1 max-w-[320px]">连接外部工具和数据服务，让 Kiro 在需要时调用。支持 Remote MCP (Streamable HTTP)，默认 https，http 仅允许 127.0.0.1/localhost。</p>
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
                          {conn.toolCount} Tools · {conn.resourceCount} Resources {conn.serverInfo?.name ? `· ${conn.serverInfo.name}` : ""}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-[11px]">
                          <span className="px-2 py-1 bg-[#F7F5F5] border border-line rounded-full">Kiro 使用 {conn.config.enabled ? "已允许" : "已禁用"}</span>
                          <span className="px-2 py-1 bg-alabaster border border-line rounded-full">副作用操作 每次确认</span>
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

        <div className="space-y-3" data-testid="extensions-channels-panel" data-setting-id="extensions-channels" hidden={activeTab !== "channels"}>
          <ChannelSettings />
          {/* Legacy provider cards kept for Gmail/QQ Mail placeholder */}
          <div className="grid gap-3 sm:grid-cols-1 mt-4">
            {channelProviders.filter((p) => p.id !== "qq-bot").map((provider) => {
              const isOnline = extensions.some((e) => e.providerId === provider.id && e.status === "connected");
              const statusLabel = isOnline ? "已连接" : "未连接";
              const settingId = provider.id === "gmail" ? "extensions-gmail" : "extensions-qq-mail";
              return (
                <div
                  key={provider.id}
                  data-setting-id={settingId}
                  className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 opacity-60"
                  data-testid={`channel-card-${provider.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-alabaster border border-line flex items-center justify-center shrink-0 mt-0.5">
                        {provider.id === "gmail" ? <ExternalLink className="w-4 h-4 text-charcoal" /> : <Wrench className="w-4 h-4 text-charcoal" />}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-charcoal">{provider.name} <span className="text-[11px] font-normal text-sandrift">（占位）</span></h4>
                        <p className="text-xs text-sandrift mt-0.5 leading-relaxed">{provider.description}</p>
                      </div>
                    </div>
                    <span className={cn("shrink-0 px-2 py-1 rounded-full text-[11px] font-bold border", isOnline ? "bg-success/10 text-success border-success/20" : "bg-[#F7F5F5] text-satin-grey border-line")}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-sandrift">{provider.capabilities.join(" · ")}</span>
                    <button type="button" onClick={() => setProviderDetail({ id: provider.id, name: provider.name })} data-testid={`channel-connect-${provider.id}`} className="h-7 px-3 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg shrink-0">连接</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      <Dialog
        open={providerDetail !== null}
        onOpenChange={(open) => {
          if (!open) setProviderDetail(null);
        }}
        overlayId="extensions-provider-detail"
        aria-label={providerDetail ? `${providerDetail.name} 详情` : "渠道详情"}
        className="w-[min(480px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-3"
      >
        {providerDetail && (
          <>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
                <Plug2 className="w-4 h-4 text-charcoal" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-charcoal">{providerDetail.name}</h4>
                <p className="text-[11px] text-sandrift">基础设施尚未启用</p>
              </div>
            </div>
            <p className="text-xs text-satin-grey leading-relaxed">
              {providerDetail.id === "qq-bot"
                ? "QQ Bot 连接需要完成桌面端授权与消息通道配置，当前为占位预览。"
                : providerDetail.id === "gmail"
                  ? "Gmail 需完成 OAuth 授权后方可接收课程通知与附件，当前为占位预览。"
                  : "QQ 邮箱需完成授权后方可接收相关邮件，当前为占位预览。"}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProviderDetail(null)}
                className="h-8 px-4 bg-alabaster hover:bg-[#E8E5E1] border border-line text-charcoal text-xs font-bold rounded-lg transition-colors"
              >
                知道了
              </button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={mcpPlaceholderOpen}
        onOpenChange={setMcpPlaceholderOpen}
        overlayId="extensions-mcp-placeholder"
        aria-label="添加 MCP"
        className="w-[min(480px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
            <Boxes className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-charcoal">添加 MCP</h4>
            <p className="text-[11px] text-sandrift">基础设施尚未启用</p>
          </div>
        </div>
        <p className="text-xs text-satin-grey leading-relaxed">MCP 连接需要桌面运行时与 Tool Discovery 支持，当前版本仅提供 UI 占位。</p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setMcpPlaceholderOpen(false)}
            className="h-8 px-4 bg-alabaster hover:bg-[#E8E5E1] border border-line text-charcoal text-xs font-bold rounded-lg transition-colors"
          >
            知道了
          </button>
        </div>
      </Dialog>

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
          <p className="text-[11px] text-sandrift">Remote MCP · Streamable HTTP · 默认 https</p>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold text-charcoal">名称 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notion MCP" data-testid="mcp-add-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">Endpoint *</label>
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://mcp.example.com/mcp" data-testid="mcp-add-endpoint" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono" />
          <p className="text-[11px] text-sandrift mt-1">V1 仅支持 Remote MCP (https)，http 仅允许 127.0.0.1/localhost（开发模式）</p>
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">凭据 (SecretVault credentialRef)</label>
          <input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="cred_xxx（可选，来自 SecretVault）" data-testid="mcp-add-credential" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono" />
          <p className="text-[11px] text-sandrift mt-1">禁止明文 token/apiKey 写入 Zustand；Secret 来自 SecretVault</p>
        </div>
        {testResult && (
          <div className={`text-xs font-bold px-3 py-2 rounded-lg border ${testResult.ok ? "text-success bg-success/5 border-success/20" : "text-danger bg-danger/5 border-danger/20"}`}>
            {testResult.ok ? `连接成功${testResult.serverInfo ? ` · ${(testResult.serverInfo as { name?: string })?.name ?? ""}` : ""}` : `测试失败: ${testResult.error}`}
            {testResult.ok && (testResult as { tools?: unknown[] }).tools && <p className="text-[11px] font-normal mt-1">{(testResult as { tools?: unknown[] }).tools?.length ?? 0} Tools 已发现</p>}
          </div>
        )}
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleTest} data-testid="mcp-test" className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster">测试连接</button>
          <div className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} data-testid="mcp-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60">{saving ? "保存中..." : "保存"}</button>
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
    try {
      if (action === "connect") await bridge.connect({ id: connection.config.id });
      if (action === "disconnect") await bridge.disconnect({ id: connection.config.id });
      if (action === "remove") {
        if (!confirm(`确定删除 MCP "${connection.config.name}"？`)) return;
        await bridge.remove({ id: connection.config.id });
      }
      if (action === "toggle") await bridge.setEnabled({ id: connection.config.id, enabled: !connection.config.enabled });
      onRefresh();
      if (action === "remove") onOpenChange(false);
    } catch (e) {
      alert((e as Error).message ?? String(e));
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
        <div className="bg-[#F7F5F5] border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.toolCount}</p>
          <p className="text-[11px] text-sandrift">Tools</p>
        </div>
        <div className="bg-[#F7F5F5] border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.resourceCount}</p>
          <p className="text-[11px] text-sandrift">Resources</p>
        </div>
        <div className="bg-[#F7F5F5] border border-line rounded-lg p-2">
          <p className="text-sm font-bold text-charcoal">{connection.promptCount}</p>
          <p className="text-[11px] text-sandrift">Prompts</p>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <p><span className="font-bold">连接信息：</span>{connection.config.endpoint}</p>
        <p><span className="font-bold">凭据：</span>{connection.config.credentialRef ? `credentialRef ${connection.config.credentialRef.slice(0, 8)}...` : "无 (公开)"}</p>
        <p><span className="font-bold">权限：</span>Kiro 使用 已允许 · 副作用操作 每次确认</p>
        {connection.serverInfo && <p><span className="font-bold">Server：</span>{connection.serverInfo.name} {connection.serverInfo.version}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {connection.state !== "connected" ? (
          <button type="button" onClick={() => handleAction("connect")} data-testid="mcp-connect" className="h-8 px-4 bg-charcoal text-white text-xs font-bold rounded-lg">连接</button>
        ) : (
          <button type="button" onClick={() => handleAction("disconnect")} data-testid="mcp-disconnect" className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">断开</button>
        )}
        <button type="button" onClick={() => handleAction("toggle")} data-testid="mcp-toggle" className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">{connection.config.enabled ? "停用" : "启用"}</button>
        <button type="button" onClick={() => handleAction("remove")} data-testid="mcp-remove" className="h-8 px-4 bg-white border border-line text-danger text-xs font-bold rounded-lg">删除</button>
        <div className="flex-1" />
        <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-alabaster border border-line text-charcoal text-xs font-bold rounded-lg">关闭</button>
      </div>
    </Dialog>
  );
}

function SummaryCard({ label, value, total, exact }: { label: string; value: number; total: number; exact: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-3 flex flex-col items-center justify-center gap-1 min-h-[64px]">
      <span className="text-sm font-bold text-charcoal" data-testid={`summary-${label}`}>{exact}</span>
      <span className="text-[11px] font-medium text-sandrift">
        {value} / {total}
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
  const [triggers, setTriggers] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [license, setLicense] = useState("");
  const [compatibility, setCompatibility] = useState("");
  const [permissionsNote, setPermissionsNote] = useState("Skill cannot elevate permissions. Skill instructions provide workflow guidance only.");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingSkill) {
        setName(editingSkill.name);
        setDescription(editingSkill.description);
        setTriggers((editingSkill.triggers ?? []).join(", "));
        setWorkflow("");
        setCapabilities((editingSkill.metadata as unknown as { capabilities?: string[] })?.capabilities?.join(", ") ?? "");
        setLicense(editingSkill.license ?? "");
        setCompatibility(editingSkill.compatibility ?? "");
        setPermissionsNote("Skill cannot elevate permissions.");
        const bridge = getSkillBridge();
        if (bridge) {
          bridge
            .get({ name: editingSkill.name })
            .then((res) => {
              const skill = (res as { skill: { instructions?: string } }).skill;
              if (skill?.instructions) setWorkflow(skill.instructions);
            })
            .catch(() => {});
        }
      } else {
        setName("");
        setDescription("");
        setTriggers("");
        setWorkflow(`# Workflow\n\n1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`);
        setCapabilities("");
        setLicense("");
        setCompatibility("");
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
      const payload = {
        name: name.trim(),
        description: description.trim(),
        instructions: workflow.trim(),
        license: license.trim() || undefined,
        compatibility: compatibility.trim() || undefined,
        metadata: {
          triggers: triggers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          capabilities: capabilities
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          permissionsNote,
        },
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
          <p className="text-[11px] text-sandrift">表单 + Markdown Instructions Editor</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold text-charcoal">名称 *</label>
          <p className="text-[11px] text-sandrift">小写字母/数字/连字符，唯一，需与文件夹名一致</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
            placeholder="course-notification"
            data-testid="skill-editor-name"
            className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal disabled:bg-[#F7F5F5] disabled:text-sandrift"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">描述 *</label>
          <p className="text-[11px] text-sandrift">必填，简要说明 Skill 用途</p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="将课程通知中的作业、DDL、调课信息整理为 ClassFlow 操作建议。"
            data-testid="skill-editor-description"
            className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">什么时候使用</label>
          <p className="text-[11px] text-sandrift">触发关键词，逗号分隔（如：课程 · DDL · 通知）</p>
          <input
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
            placeholder="课程, DDL, 通知"
            data-testid="skill-editor-triggers"
            className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">工作流程 *</label>
          <p className="text-[11px] text-sandrift">Markdown 格式，描述 Skill 的执行步骤</p>
          <textarea
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            placeholder={`1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`}
            data-testid="skill-editor-workflow"
            rows={8}
            className="mt-1 w-full p-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal font-mono leading-relaxed"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-charcoal">需要的能力</label>
            <input
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="filesystem, terminal"
              data-testid="skill-editor-capabilities"
              className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-charcoal">兼容性</label>
            <input
              value={compatibility}
              onChange={(e) => setCompatibility(e.target.value)}
              placeholder="windows"
              data-testid="skill-editor-compatibility"
              className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">许可</label>
          <input
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            placeholder="MIT"
            data-testid="skill-editor-license"
            className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm text-charcoal placeholder-sandrift focus:outline-none focus:border-charcoal"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-charcoal">权限说明</label>
          <p className="text-[11px] text-sandrift">Skill 不能提权，仅提供工作流指引</p>
          <input
            value={permissionsNote}
            onChange={(e) => setPermissionsNote(e.target.value)}
            data-testid="skill-editor-permissions"
            className="mt-1 w-full h-9 px-3 bg-[#F7F5F5] border border-line rounded-lg text-sm text-sandrift focus:outline-none"
          />
        </div>
        {error && (
          <p data-testid="skill-editor-error" className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={async () => {
              const bridge = getSkillBridge();
              if (!bridge || !name) return;
              try {
                const res = (await bridge.test({ name })) as { ok: boolean; errors: string[] };
                setError(res.ok ? "测试通过" : `测试失败: ${res.errors.join("; ")}`);
              } catch (e) {
                setError(`测试失败: ${(e as { message?: string })?.message ?? String(e)}`);
              }
            }}
            data-testid="skill-editor-test"
            className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors flex items-center gap-1.5"
          >
            <Beaker className="w-3.5 h-3.5" />
            测试
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              data-testid="skill-editor-save"
              className="h-8 px-5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle disabled:opacity-60"
            >
              {saving ? "保存中…" : isEdit ? "保存" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
