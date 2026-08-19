"use client";

import React, { useMemo, useState } from "react";
import { Plug2, Wrench, MessageSquare, Plus, Puzzle, Boxes, ExternalLink, Info } from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useExtensionsStore } from "@/store/useExtensionsStore";
import { listChannelProviders } from "@/lib/extensions/registry";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";

/**
 * 连接与扩展 — Skills / MCP / 消息渠道
 * 只做 UI Shell（不实现 Skill Runtime / MCP 连接 / OAuth）。
 * 顶部 summary、registry 驱动渲染、Zustand persist 仅存 credentialRef。
 */
export function ExtensionsSettings() {
  const extensions = useExtensionsStore((s) => s.extensions);
  const activeTab = useExtensionsStore((s) => s.activeTab);
  const setActiveTab = useExtensionsStore((s) => s.setActiveTab);

  const counts = useMemo(() => {
    const skills = extensions.filter((e) => e.kind === "skill").length;
    const enabledSkills = extensions.filter((e) => e.kind === "skill" && e.enabled).length;
    const mcp = extensions.filter((e) => e.kind === "mcp").length;
    const connectedMcp = extensions.filter((e) => e.kind === "mcp" && e.status === "connected").length;
    const channels = extensions.filter((e) => e.kind === "channel").length;
    const onlineChannels = extensions.filter((e) => e.kind === "channel" && e.status === "connected").length;
    return { skills, enabledSkills, mcp, connectedMcp, channels, onlineChannels };
  }, [extensions]);

  const channelProviders = listChannelProviders();

  const [providerDetail, setProviderDetail] = useState<null | { id: string; name: string }>(null);
  const [mcpPlaceholderOpen, setMcpPlaceholderOpen] = useState(false);
  const [skillPlaceholderOpen, setSkillPlaceholderOpen] = useState(false);

  return (
    <div className="space-y-6" data-testid="settings-extensions">
      <SettingsSection
        title="连接与扩展"
        description="让 Kiro 使用你的工作流、外部工具与消息来源。"
      >
        {/* Top summary — 布局稳定（空数据亦占位）；文案精确匹配验收字符串 */}
        <div
          data-setting-id="extensions-overview"
          className="grid grid-cols-3 gap-2 text-center"
          data-testid="extensions-summary"
        >
          <SummaryCard label="Skills 已启用" value={counts.enabledSkills} total={counts.skills} exact={`${counts.enabledSkills} 个 Skills 已启用`} />
          <SummaryCard label="MCP 已连接" value={counts.connectedMcp} total={counts.mcp} exact={`${counts.connectedMcp} 个 MCP 已连接`} />
          <SummaryCard label="消息渠道在线" value={counts.onlineChannels} total={counts.channels} exact={`${counts.onlineChannels} 个消息渠道在线`} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#F7F5F5] border border-line rounded-xl w-fit" role="tablist" aria-label="扩展类型">
          <TabButton active={activeTab === "skills"} onClick={() => setActiveTab("skills")} icon={Puzzle} label="Skills" testId="extensions-tab-skills" />
          <TabButton active={activeTab === "mcp"} onClick={() => setActiveTab("mcp")} icon={Boxes} label="MCP" testId="extensions-tab-mcp" />
          <TabButton active={activeTab === "channels"} onClick={() => setActiveTab("channels")} icon={MessageSquare} label="消息渠道" testId="extensions-tab-channels" />
        </div>

        {/* ---- Skills ---- */}
        <div className="space-y-3" data-testid="extensions-skills-panel" data-setting-id="extensions-skills" hidden={activeTab !== "skills"}>
          <SettingsGroup title="Skills" description="将常用的 Kiro 工作流程保存为可复用能力。">
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                <Puzzle className="w-5 h-5 text-charcoal" />
              </div>
              <div>
                <p className="text-sm font-bold text-charcoal">还没有 Skill</p>
                <p className="text-xs text-sandrift mt-1 max-w-[320px]">将常用的 Kiro 工作流程保存为可复用能力，随时复用。</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setSkillPlaceholderOpen(true)}
                  data-testid="extensions-create-skill"
                  className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  创建 Skill
                </button>
                <button
                  type="button"
                  disabled
                  title="从 Kiro 工作流创建（即将推出）"
                  className="h-8 px-4 bg-white border border-line text-satin-grey text-xs font-bold rounded-lg opacity-60 cursor-not-allowed flex items-center gap-1.5"
                >
                  从 Kiro 工作流创建
                </button>
              </div>
            </div>
          </SettingsGroup>
        </div>

        {/* ---- MCP ---- */}
        <div className="space-y-3" data-testid="extensions-mcp-panel" data-setting-id="extensions-mcp" hidden={activeTab !== "mcp"}>
          <SettingsGroup title="MCP" description="连接外部工具和数据服务，让 Kiro 在需要时调用。">
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
                <Boxes className="w-5 h-5 text-charcoal" />
              </div>
              <div>
                <p className="text-sm font-bold text-charcoal">还没有 MCP 连接</p>
                <p className="text-xs text-sandrift mt-1 max-w-[320px]">连接外部工具和数据服务，让 Kiro 在需要时调用。</p>
              </div>
              <button
                type="button"
                onClick={() => setMcpPlaceholderOpen(true)}
                data-testid="extensions-add-mcp"
                className="mt-1 h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                添加 MCP
              </button>
            </div>
          </SettingsGroup>
        </div>

        {/* ---- 消息渠道 ---- */}
        <div className="space-y-3" data-testid="extensions-channels-panel" data-setting-id="extensions-channels" hidden={activeTab !== "channels"}>
          <div className="grid gap-3 sm:grid-cols-1">
            {channelProviders.map((provider) => {
              const isOnline = extensions.some((e) => e.providerId === provider.id && e.status === "connected");
              const statusLabel = isOnline ? "已连接" : "未连接";
              // 每个 provider 都有独立的 registry id 用于搜索跳转
              const settingId =
                provider.id === "qq-bot"
                  ? "extensions-qq-bot"
                  : provider.id === "gmail"
                    ? "extensions-gmail"
                    : "extensions-qq-mail";
              return (
                <div
                  key={provider.id}
                  data-setting-id={settingId}
                  className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
                  data-testid={`channel-card-${provider.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-alabaster border border-line flex items-center justify-center shrink-0 mt-0.5">
                        {provider.id === "qq-bot" ? (
                          <MessageSquare className="w-4 h-4 text-charcoal" />
                        ) : provider.id === "gmail" ? (
                          <ExternalLink className="w-4 h-4 text-charcoal" />
                        ) : (
                          <Wrench className="w-4 h-4 text-charcoal" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-charcoal">{provider.name}</h4>
                        <p className="text-xs text-sandrift mt-0.5 leading-relaxed">{provider.description}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 px-2 py-1 rounded-full text-[11px] font-bold border",
                        isOnline
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-[#F7F5F5] text-satin-grey border-line"
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-sandrift">
                      {provider.capabilities.join(" · ")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setProviderDetail({ id: provider.id, name: provider.name })}
                      data-testid={`channel-connect-${provider.id}`}
                      className="h-7 px-3 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shrink-0"
                    >
                      连接
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      {/* Provider detail placeholder dialog */}
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

      {/* MCP placeholder */}
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

      {/* Skill placeholder */}
      <Dialog
        open={skillPlaceholderOpen}
        onOpenChange={setSkillPlaceholderOpen}
        overlayId="extensions-skill-placeholder"
        aria-label="创建 Skill"
        className="w-[min(480px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
            <Puzzle className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-charcoal">创建 Skill</h4>
            <p className="text-[11px] text-sandrift">基础设施尚未启用</p>
          </div>
        </div>
        <p className="text-xs text-satin-grey leading-relaxed">Skill 会将 Kiro 工作流保存为可复用能力，当前为 UI 占位，后续可从 Kiro 工作流一键创建。</p>
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            disabled
            className="h-8 px-4 bg-white border border-line text-satin-grey text-xs font-bold rounded-lg opacity-60 cursor-not-allowed"
          >
            从 Kiro 工作流创建（即将推出）
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSkillPlaceholderOpen(false)}
            className="h-8 px-4 bg-alabaster hover:bg-[#E8E5E1] border border-line text-charcoal text-xs font-bold rounded-lg transition-colors"
          >
            知道了
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-sandrift">
          <Info className="w-3.5 h-3.5" />
          后续接入 Skill Runtime 后可用。
        </p>
      </Dialog>
    </div>
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
