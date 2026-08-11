"use client";

import React, { useState } from "react";
import { Check, Loader2, Eye, EyeOff, PlugZap } from "lucide-react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey, setSessionApiKey } from "@/lib/ai/sessionKeys";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { AI_ERROR_MESSAGES, AIErrorCode } from "@/lib/ai/errors";
import { AIProviderId } from "@/lib/ai/providers/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl, SettingsButton, SettingsInput } from "@/components/settings/SettingsControls";
import { KiroMemorySettings } from "@/components/settings/KiroMemorySettings";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KiroOutputTextSize } from "@/lib/ai/ui/typography";
import { KiroResponsePreference } from "@/lib/ai/responsePreference";
import { cn } from "@/lib/utils";

const PROVIDER_OPTIONS: { value: AIProviderId; label: string }[] = [
  { value: "opencode-go", label: "OpenCode Go" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom-openai", label: "自定义 OpenAI 兼容服务" },
];

type TestState = { status: "idle" | "testing" } | { status: "success" } | { status: "error"; message: string };

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
  // Task 7E：自动环境上下文（纯 interaction preference，不放 useAISettingsStore）
  const autoContextEnabled = useKiroPreferencesStore((s) => s.autoContextEnabled);
  const setAutoContextEnabled = useKiroPreferencesStore((s) => s.setAutoContextEnabled);
  // Intelligence V2 Task 1：回答偏好（随 Turn Snapshot 冻结；只影响 Final Answer 表达深度）
  const responsePreference = useKiroPreferencesStore((s) => s.responsePreference);
  const setResponsePreference = useKiroPreferencesStore((s) => s.setResponsePreference);

  const RESPONSE_PREFERENCE_DESCRIPTIONS: Record<KiroResponsePreference, string> = {
    dense: "结论、关键事实与行动优先",
    balanced: "在结论之外补充必要原因",
    deep: "更完整解释；必要时附一段直接相关的学习建议",
  };

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
      title="Kiro 与 AI"
      description="配置 Kiro 的 AI 服务与回答行为。API Key 默认仅保存在当前浏览器会话中。"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro">
        {/* 总开关 */}
        <SettingsGroup>
          <SettingsRow
            settingId="ai-enabled"
            title="启用 Kiro"
            description="关闭后 Kiro 仅保留界面预览，不发起任何请求。"
          >
            <SettingsToggle checked={enabled} onChange={setEnabled} label="启用 Kiro" />
          </SettingsRow>
        </SettingsGroup>

        {/* ---- 模型 ---- */}
        <SettingsGroup title="模型">
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
            <>
              <SettingsRow
                settingId="ai-custom-name"
                title="Provider 名称"
                description="仅用于识别，如「本地网关」。"
              >
                <SettingsInput
                  value={custom.providerName}
                  onChange={(v) => setCustom({ providerName: v })}
                  placeholder="如：公司网关"
                />
              </SettingsRow>
              <SettingsRow
                settingId="ai-custom-url"
                title="Base URL"
                description="https:// 开头，兼容 OpenAI Chat Completions；私网地址会被拒绝。"
              >
                <SettingsInput
                  value={custom.baseURL}
                  onChange={(v) => setCustom({ baseURL: v })}
                  placeholder="https://provider.example.com/v1"
                  mono
                />
              </SettingsRow>
              <SettingsRow
                settingId="ai-custom-model"
                title="Model ID"
                description="手动填写该服务支持的模型 ID。"
              >
                <SettingsInput
                  value={custom.model}
                  onChange={(v) => setCustom({ model: v })}
                  placeholder="如：my-model"
                  mono
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
            </>
          )}

          <SettingsRow
            settingId="ai-api-key"
            title="API Key"
            description="API Key 默认仅保存在当前浏览器会话中（调用时会发送到 ClassFlow 服务端转发）。"
          >
            <div className="relative w-full">
              <SettingsInput
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={handleApiKeyChange}
                placeholder="sk-..."
                ariaLabel="API Key"
                autoComplete="off"
                spellCheck={false}
                mono
                className="pr-9"
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

          {/* 连接状态 / 测试连接：只发送极小测试请求，不发送任何 ClassFlow 数据 */}
          <SettingsRow settingId="ai-connection-status" title="连接状态" description="向当前服务发送最小测试请求，验证 API Key 与模型可用性。">
            <div className="flex items-center gap-2.5">
              <SettingsButton
                variant="accent"
                onClick={runTest}
                disabled={test.status === "testing" || !enabled}
              >
                {test.status === "testing" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlugZap className="w-3.5 h-3.5" />
                )}
                测试连接
              </SettingsButton>
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
          </SettingsRow>
        </SettingsGroup>

        {/* ---- 回答 ---- */}
        <SettingsGroup title="回答">
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

          <SettingsRow
            settingId="kiro-response-preference"
            title="回答偏好"
            description="只调整 Kiro 最终回答的表达深度，不影响必要的数据读取、工具调用或安全规则。"
          >
            <div className="flex flex-col items-end gap-1">
              <SettingsSegmentedControl<KiroResponsePreference>
                value={responsePreference}
                onChange={setResponsePreference}
                ariaLabel="Kiro 回答偏好"
                options={[
                  { value: "dense", label: "高密度" },
                  { value: "balanced", label: "平衡" },
                  { value: "deep", label: "深入" },
                ]}
              />
              <p className="text-[10px] text-sandrift leading-relaxed text-right max-w-[220px]">
                {RESPONSE_PREFERENCE_DESCRIPTIONS[responsePreference]}
              </p>
            </div>
          </SettingsRow>

          <SettingsRow
            settingId="kiro-auto-context"
            title="自动环境上下文"
            description="根据当前页面、时间范围和选中对象，自动为 Kiro 带入相关上下文。关闭后仍可通过 @ 手动添加课程、任务和资料。"
          >
            <SettingsToggle
              checked={autoContextEnabled}
              onChange={setAutoContextEnabled}
              label="自动环境上下文"
            />
          </SettingsRow>
        </SettingsGroup>

        {/* ---- 记忆 ---- */}
        <SettingsGroup title="记忆">
          <KiroMemorySettings />
        </SettingsGroup>

        {/* ---- 隐私 ---- */}
        <SettingsGroup title="隐私">
          <SettingsRow settingId="kiro-privacy-local" title="本地优先" description="课程、任务、记忆与聊天历史保存在当前浏览器；附件正文存入 IndexedDB。">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              本地存储
            </span>
          </SettingsRow>
          <SettingsRow settingId="kiro-privacy-api-key" title="API Key" description="仅保存在当前浏览器会话（sessionStorage），不写入本地存储、备份或日志。">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              会话级
            </span>
          </SettingsRow>
          <SettingsRow settingId="kiro-privacy-context" title="上下文发送" description="发送给 AI 服务的仅包括当前对话、必要的 ClassFlow 上下文与你选择的资料内容。">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              按需发送
            </span>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
