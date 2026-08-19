/**
 * Provider Registry — 统一扩展提供方元数据（Task 04）。
 * 目标：以后添加 Telegram / Outlook / 教务系统时无需改 Settings 页面；
 * UI 从 registry 渲染，不在 JSX 写大量 if provider === ...
 */

import type { ChannelProviderMeta, ProviderMeta, ChannelProvider } from "@/lib/extensions/types";

export const CHANNEL_PROVIDERS: ChannelProviderMeta[] = [
  {
    id: "qq-bot",
    kind: "channel",
    name: "QQ Bot",
    description: "通过 QQ 与 Kiro 对话，将课程通知和消息交给 ClassFlow 处理。",
    capabilities: ["receive-message", "send-message"],
  },
  {
    id: "gmail",
    kind: "channel",
    name: "Gmail",
    description: "从 Gmail 接收课程通知、DDL 和相关附件。",
    capabilities: ["receive-email", "attachment"],
  },
  {
    id: "qq-mail",
    kind: "channel",
    name: "QQ 邮箱",
    description: "从 QQ 邮箱接收课程通知和学习相关邮件。",
    capabilities: ["receive-email", "attachment"],
  },
];

export const SKILL_TEMPLATE: ProviderMeta = {
  id: "skill-template",
  kind: "skill",
  name: "Skill",
  description: "将常用的 Kiro 工作流程保存为可复用能力。",
  capabilities: ["workflow"],
};

export const MCP_TEMPLATE: ProviderMeta = {
  id: "mcp-template",
  kind: "mcp",
  name: "MCP",
  description: "连接外部工具和数据服务，让 Kiro 在需要时调用。",
  capabilities: ["tool"],
};

/** 全部 Provider（用于 UI 渲染与搜索） */
export const ALL_PROVIDERS: ProviderMeta[] = [...CHANNEL_PROVIDERS, SKILL_TEMPLATE, MCP_TEMPLATE];

/** 按 id 查找 */
export function getProviderMeta(id: string): ProviderMeta | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? CHANNEL_PROVIDERS.find((p) => p.id === id as ChannelProvider);
}

export function getChannelProvider(id: ChannelProvider): ChannelProviderMeta | undefined {
  return CHANNEL_PROVIDERS.find((p) => p.id === id);
}

export function listChannelProviders(): ChannelProviderMeta[] {
  return [...CHANNEL_PROVIDERS];
}

/** Registry 完整性校验（纯函数，测试用） */
export function validateRegistry(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const p of ALL_PROVIDERS) {
    if (ids.has(p.id)) errors.push(`duplicate provider id: ${p.id}`);
    ids.add(p.id);
    if (!p.name || !p.description) errors.push(`missing name/description for ${p.id}`);
  }
  // 必须包含三个首批 channel
  for (const required of ["qq-bot", "gmail", "qq-mail"] as ChannelProvider[]) {
    if (!CHANNEL_PROVIDERS.some((p) => p.id === required)) {
      errors.push(`missing required channel provider: ${required}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
