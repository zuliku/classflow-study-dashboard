"use client";

import React, { useState } from "react";
import { Check, Loader2, Eye, EyeOff, PlugZap } from "lucide-react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey, setSessionApiKey } from "@/lib/ai/sessionKeys";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { AI_ERROR_MESSAGES, AIErrorCode } from "@/lib/ai/errors";
import { AIProviderId } from "@/lib/ai/providers/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import { KiroMemorySettings } from "@/components/settings/KiroMemorySettings";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KiroOutputTextSize } from "@/lib/ai/ui/typography";

const PROVIDER_OPTIONS: { value: AIProviderId; label: string }[] = [
  { value: "opencode-go", label: "OpenCode Go" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom-openai", label: "自定义 OpenAI 兼容服务" },
];

type TestState = { status: "idle" | "testing" } | { status: "success" } | { status: "error"; message: string };

const inputCls =
  "w-full h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-xl text-xs font-semibold text-charcoal focus:outline-none focus:border-charcoal placeholder-sandrift";

/** Kiro / AI 服务设置：Provider / 模型 / API Key（sessionStorage）/ 自定义服务 / 测试连接 */
export function KiroAISettings() {
  const {
    enabled,
    provider,
    model,
    custom,
    setEnabled,
    setProvider,
    setModel,
    setCustom,
  } = useAISettingsStore();
  // Task 7D：输出字号是纯 UI preference，仍属于 useKiroPreferencesStore（与 Rail More 菜单同一事实来源）
  const outputTextSize = useKiroPreferencesStore((s) => s.outputTextSize);
  const setOutputTextSize = useKiroPreferencesStore((s) => s.setOutputTextSize);

  const [apiKeyInput, setApiKeyInput] = useState(getSessionApiKey(provider));
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  // 统一模型 Catalog：Settings 与 Composer 共用同一模型集合（Task 10）
  const { models: catalogModels } = useAIModelCatalog(provider);
  const models = catalogModels;
  const isCustom = provider === "custom-openai";
  // 当前模型不在 Catalog（已下线/远端不可用）：提示重新选择，不自动覆盖
  const modelUnavailable = !isCustom && !!model && !models.some((m) => m.id === model);

  const handleProviderChange = (p: AIProviderId) => {
    setProvider(p);
    setApiKeyInput(getSessionApiKey(p));
    setTest({ status: "idle" });
  };

  const handleApiKeyChange = (v: string) => {
    setApiKeyInput(v);
    setSessionApiKey(provider, v);
  };

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          apiKey: getSessionApiKey(provider),
          customConfig: custom,
          timeoutMs: 10_000,
        }),
      });
      const data = (await res.json()) as { ok: boolean; code?: AIErrorCode; message?: string };
      if (data.ok) setTest({ status: "success" });
      else setTest({ status: "error", message: data.message || AI_ERROR_MESSAGES[data.code ?? "UNKNOWN"] });
    } catch {
      setTest({ status: "error", message: AI_ERROR_MESSAGES.PROVIDER_UNAVAILABLE });
    }
  };

  return (
    <SettingsSection
      title="Kiro / AI 服务"
      description="配置 Kiro 的 AI 服务。API Key 默认仅保存在当前浏览器会话中。"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro">
        <SettingsRow
          settingId="ai-enabled"
          title="启用 Kiro"
          description="关闭后 Kiro 仅保留界面预览，不发起任何请求。"
        >
          <SettingsToggle checked={enabled} onChange={setEnabled} label="启用 Kiro" />
        </SettingsRow>

        <SettingsRow
          settingId="ai-provider"
          title="AI 服务"
          description="选择模型来源，配置保存在本地（不含 API Key）。"
        >
          <SettingsSelect
            value={provider}
            onChange={handleProviderChange}
            ariaLabel="AI 服务"
            options={PROVIDER_OPTIONS}
          />
        </SettingsRow>

        {!isCustom ? (
          <SettingsRow
            settingId="ai-model"
            title="模型"
            description={
              provider === "deepseek"
                ? "V4 Flash 适合日常对话，V4 Pro 质量更高。"
                : "OpenCode Go 当前可用模型。"
            }
          >
            <div className="flex flex-col items-end gap-1">
              <SettingsSelect
                value={model}
                onChange={setModel}
                ariaLabel="模型"
                options={models.map((m) => ({ value: m.id, label: m.name }))}
              />
              {modelUnavailable && (
                <span className="text-[10px] font-semibold text-danger">当前模型已不可用，请重新选择。</span>
              )}
            </div>
          </SettingsRow>
        ) : (
          <div className="space-y-4 pt-1">
            <SettingsRow
              settingId="ai-custom-name"
              title="Provider 名称"
              description="仅用于识别，如「本地网关」。"
            >
              <input
                type="text"
                value={custom.providerName}
                onChange={(e) => setCustom({ providerName: e.target.value })}
                placeholder="如：公司网关"
                className={inputCls}
              />
            </SettingsRow>
            <SettingsRow
              settingId="ai-custom-url"
              title="Base URL"
              description="https:// 开头，兼容 OpenAI Chat Completions；私网地址会被拒绝。"
            >
              <input
                type="text"
                value={custom.baseURL}
                onChange={(e) => setCustom({ baseURL: e.target.value })}
                placeholder="https://provider.example.com/v1"
                className={`${inputCls} font-mono`}
              />
            </SettingsRow>
            <SettingsRow
              settingId="ai-custom-model"
              title="Model ID"
              description="手动填写该服务支持的模型 ID。"
            >
              <input
                type="text"
                value={custom.model}
                onChange={(e) => setCustom({ model: e.target.value })}
                placeholder="如：my-model"
                className={`${inputCls} font-mono`}
              />
            </SettingsRow>
            <SettingsRow
              settingId="ai-custom-capabilities"
              title="模型能力"
              description="只有你的兼容服务实际支持这些能力时才开启；默认关闭（保守策略）。"
            >
              <div className="flex items-center gap-4 text-[11px] font-semibold text-satin-grey">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={custom.vision === true}
                    onChange={(e) => setCustom({ vision: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-charcoal"
                  />
                  支持图片输入
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={custom.fileParts === true}
                    onChange={(e) => setCustom({ fileParts: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-charcoal"
                  />
                  支持文件输入
                </label>
              </div>
            </SettingsRow>
          </div>
        )}

        <SettingsRow
          settingId="ai-api-key"
          title="API Key"
          description="API Key 默认仅保存在当前浏览器会话中（调用时会发送到 ClassFlow 服务端转发）。"
        >
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} pr-9 font-mono`}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </SettingsRow>

        {/* 测试连接：只发送极小测试请求，不发送任何 ClassFlow 数据 */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            onClick={runTest}
            disabled={test.status === "testing" || !enabled}
            className="ux-press flex items-center gap-1.5 px-3 h-9 rounded-xl text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40"
          >
            {test.status === "testing" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlugZap className="w-3.5 h-3.5" />
            )}
            测试连接
          </button>
          {test.status === "success" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
              <Check className="w-3.5 h-3.5" />
              连接成功
            </span>
          )}
          {test.status === "error" && (
            <span className="text-[11px] font-semibold text-danger">{test.message}</span>
          )}
        </div>

        {/* Task 7D：输出字号（即时生效并持久化；与 Kiro Rail More 菜单同一 store） */}
        <SettingsRow
          settingId="kiro-output-text-size"
          title="输出字号"
          description="调整 Kiro 回复正文、公式、代码与表格的显示大小。"
        >
          <SettingsSegmentedControl<KiroOutputTextSize>
            value={outputTextSize}
            onChange={setOutputTextSize}
            ariaLabel="Kiro 输出字号"
            options={[
              { value: "small", label: "小" },
              { value: "standard", label: "标准" },
              { value: "large", label: "大" },
            ]}
          />
        </SettingsRow>

        {/* Kiro 记忆（Task 9）：记忆开关 / 条目管理 / 清空 / 隐私说明 */}
        <div className="border-t border-line pt-4 -mx-1 px-1">
          <KiroMemorySettings />
        </div>
      </div>
    </SettingsSection>
  );
}
