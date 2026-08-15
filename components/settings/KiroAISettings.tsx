"use client";

import React, { useState, useEffect } from "react";
import { Check, Loader2, Eye, EyeOff, PlugZap, Globe2, ChevronDown } from "lucide-react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey, setSessionApiKey } from "@/lib/ai/sessionKeys";
import { useAIModelCatalog } from "@/hooks/useAIModelCatalog";
import { AI_ERROR_MESSAGES, AIErrorCode } from "@/lib/ai/errors";
import { AIProviderId } from "@/lib/ai/providers/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl, SettingsButton, SettingsInput } from "@/components/settings/SettingsControls";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { KiroMemorySettings } from "@/components/settings/KiroMemorySettings";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { KiroReasoningEffort } from "@/lib/ai/reasoning/types";
import { KiroOutputTextSize } from "@/lib/ai/ui/typography";
import { KiroResponsePreference } from "@/lib/ai/responsePreference";
import {
  getSessionWebSearchApiKey,
  setSessionWebSearchApiKey,
} from "@/lib/ai/web/credentials";
import {
  getSessionWebPdfVisionApiKey,
  setSessionWebPdfVisionApiKey,
} from "@/lib/ai/web/vision/credentials";
import { getWebPdfVisionModelOptions } from "@/lib/ai/web/vision/models";
import { cn } from "@/lib/utils";

const PROVIDER_OPTIONS: { value: AIProviderId; label: string }[] = [
  { value: "opencode-go", label: "OpenCode Go" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom-openai", label: "自定义 OpenAI 兼容服务" },
];

const REASONING_EFFORT_LABELS: Record<KiroReasoningEffort, string> = {
  default: "默认",
  low: "低",
  medium: "中",
  high: "高",
  max: "极高",
};

type TestState = { status: "idle" | "testing" } | { status: "success" } | { status: "error"; message: string };

/** Kiro / AI 服务设置：Provider / 模型 / API Key（sessionStorage）/ 自定义服务 / 测试连接 */
export function KiroAISettings() {
  const {
    enabled,
    provider,
    model,
    custom,
    reasoningEffort,
    setEnabled,
    setProvider,
    setModel,
    setCustom,
    setReasoningEffort,
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
  // Task 14：Kiro Search（联网搜索）——Key 只在 sessionStorage，不进 Store
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useKiroPreferencesStore((s) => s.setWebSearchEnabled);
  const webSearchCredentialMode = useKiroPreferencesStore((s) => s.webSearchCredentialMode);
  const setWebSearchCredentialMode = useKiroPreferencesStore((s) => s.setWebSearchCredentialMode);
  const webPdfVisionEnabled = useKiroPreferencesStore((s) => s.webPdfVisionEnabled);
  const setWebPdfVisionEnabled = useKiroPreferencesStore((s) => s.setWebPdfVisionEnabled);
  const webPdfVisionModel = useKiroPreferencesStore((s) => s.webPdfVisionModel);
  const setWebPdfVisionModel = useKiroPreferencesStore((s) => s.setWebPdfVisionModel);

  const RESPONSE_PREFERENCE_DESCRIPTIONS: Record<KiroResponsePreference, string> = {
    dense: "结论、关键事实与行动优先",
    balanced: "在结论之外补充必要原因",
    deep: "更完整解释；必要时附一段直接相关的学习建议",
  };

  const [apiKeyInput, setApiKeyInput] = useState(getSessionApiKey(provider));
  const [showKey, setShowKey] = useState(false);
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);
  // Task 3B：能力/高级设置默认收起（常用项优先，技术细节按需展开）
  const [searchSettingsOpen, setSearchSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [webSearchApiKeyInput, setWebSearchApiKeyInput] = useState(getSessionWebSearchApiKey());
  const [webPdfVisionApiKeyInput, setWebPdfVisionApiKeyInput] = useState(getSessionWebPdfVisionApiKey());
  const [showWebPdfVisionKey, setShowWebPdfVisionKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [webSearchTest, setWebSearchTest] = useState<TestState>({ status: "idle" });
  const [serverSearchConfigured, setServerSearchConfigured] = useState<boolean | null>(null);

  // Hotfix：Server Search 配置状态（null = 检测中；不阻塞 Settings 渲染）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/web-search/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { serverConfigured?: boolean } | null) => {
        if (!cancelled && data && typeof data.serverConfigured === "boolean") {
          setServerSearchConfigured(data.serverConfigured);
        }
      })
      .catch(() => {
        if (!cancelled) setServerSearchConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 统一模型 Catalog：Settings 与 Composer 共用同一模型集合（Task 10）
  const { models: catalogModels } = useAIModelCatalog(provider);
  const models = catalogModels;
  const isCustom = provider === "custom-openai";
  // 当前模型不在 Catalog（已下线/远端不可用）：提示重新选择，不自动覆盖
  const modelUnavailable = !isCustom && !!model && !models.some((m) => m.id === model);
  // Reasoning：capability-driven（与 Composer 同一事实来源 useAISettingsStore）。
  // Store 保存 requested preference（跨模型切换保留）；UI 显示 effective（当前模型 capability 归一）。
  const reasoningCapability = getModelCapabilities({ provider, model, custom }).reasoning;
  const effectiveReasoningEffort = resolveEffectiveReasoningEffort({
    provider,
    model,
    custom,
    requested: reasoningEffort,
  });

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

  /** BYOK Key：受控 React state + sessionStorage 同步（模式切换不丢失已输入值） */
  const handleWebSearchKeyChange = (value: string) => {
    setWebSearchApiKeyInput(value);
    setSessionWebSearchApiKey(value);
    setWebSearchTest({ status: "idle" });
  };

  const runWebSearchTest = async () => {
    setWebSearchTest({ status: "testing" });
    try {
      const res = await fetch("/api/ai/web-search/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialMode: webSearchCredentialMode,
          apiKey: webSearchCredentialMode === "byok" ? getSessionWebSearchApiKey() : undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; code?: string; message?: string };
      if (data.ok) setWebSearchTest({ status: "success" });
      else setWebSearchTest({ status: "error", message: data.message || "搜索服务不可用" });
    } catch {
      setWebSearchTest({ status: "error", message: "搜索服务不可用" });
    }
  };

  return (
    <SettingsSection
      title="Kiro 与 AI"
      description="配置 Kiro 的 AI 服务与回答行为。API Key 默认仅保存在当前浏览器会话中。"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro">
        {/* Kiro */}
        <SettingsGroup title="Kiro">
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
            </>
          )}

          <SettingsRow
            settingId="ai-reasoning-effort"
            title="思考程度"
            description="控制支持该能力的模型在回答前投入的推理计算。"
          >
            {reasoningCapability.adjustable ? (
              <SettingsSegmentedControl<KiroReasoningEffort>
                value={effectiveReasoningEffort}
                onChange={setReasoningEffort}
                options={reasoningCapability.supportedEfforts.map((effort) => ({
                  value: effort,
                  label: REASONING_EFFORT_LABELS[effort],
                }))}
                ariaLabel="思考程度"
              />
            ) : (
              <span className="text-[11px] font-semibold text-sandrift">当前模型不可调</span>
            )}
          </SettingsRow>

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

        {/* ---- 能力：联网搜索（主层只有开关 + summary，细节进「搜索设置」）+ 记忆 ---- */}
        <SettingsGroup title="能力">
          <SettingsRow
            settingId="kiro-web-search-enabled"
            title="联网搜索"
            description="Kiro 需要最新或可能随时间变化的信息时自动联网搜索。"
          >
            <SettingsToggle
              checked={webSearchEnabled}
              onChange={setWebSearchEnabled}
              label="联网搜索"
            />
          </SettingsRow>

          {webSearchEnabled && (
            <>
              <div className="px-3 -mt-1">
                <p className="text-[11px] text-sandrift">
                  {webSearchCredentialMode === "server" ? "ClassFlow 提供" : "使用自己的 API Key"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchSettingsOpen((v) => !v)}
                aria-expanded={searchSettingsOpen}
                className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
              >
                搜索设置
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)]",
                    searchSettingsOpen && "rotate-180"
                  )}
                  aria-hidden="true"
                />
              </button>
              <DisclosureRegion open={searchSettingsOpen}>
                <div className="space-y-1">
                  <SettingsRow settingId="kiro-web-search-service" title="搜索服务" description="Kiro Search 提供实时网页检索能力。">
                    <span className="px-2 py-0.5 rounded-full bg-pastel-mint text-[10px] font-bold text-charcoal shrink-0">
                      Kiro Search
                    </span>
                  </SettingsRow>

                  <SettingsRow
                    settingId="kiro-web-search-credential"
                    title="凭据"
                    description="选择搜索凭据来源；使用自己的 API Key 时，Key 仅保存在当前浏览器会话中。"
                  >
                    <SettingsSegmentedControl<"server" | "byok">
                      value={webSearchCredentialMode}
                      onChange={(v) => {
                        setWebSearchCredentialMode(v);
                        setWebSearchTest({ status: "idle" });
                      }}
                      ariaLabel="Kiro Search 凭据"
                      options={[
                        { value: "server", label: "ClassFlow 提供" },
                        { value: "byok", label: "自己的 API Key" },
                      ]}
                    />
                    {webSearchCredentialMode === "server" && serverSearchConfigured === false && (
                      <div className="flex flex-col gap-1.5 w-full">
                        <span className="text-[11px] font-semibold text-danger">
                          当前服务端未配置搜索凭据，请使用自己的 API Key。
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setWebSearchCredentialMode("byok");
                            setWebSearchTest({ status: "idle" });
                          }}
                          className="self-start text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
                        >
                          使用自己的 API Key
                        </button>
                      </div>
                    )}
                  </SettingsRow>

                  {webSearchCredentialMode === "byok" && (
                    <SettingsRow
                      settingId="kiro-web-search-byok-key"
                      title="Tavily API Key"
                      description="仅保存在当前浏览器会话中（调用时发送到 ClassFlow 服务端转发）。"
                    >
                      <div className="relative w-full">
                        <SettingsInput
                          type={showWebSearchKey ? "text" : "password"}
                          value={webSearchApiKeyInput}
                          onChange={handleWebSearchKeyChange}
                          placeholder="tvly-..."
                          ariaLabel="Tavily API Key"
                          autoComplete="off"
                          spellCheck={false}
                          mono
                          className="pr-9"
                        />
                        <button
                          onClick={() => setShowWebSearchKey((v) => !v)}
                          aria-label={showWebSearchKey ? "隐藏 Kiro Search API Key" : "显示 Kiro Search API Key"}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
                        >
                          {showWebSearchKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </SettingsRow>
                  )}

                  <SettingsRow
                    settingId="kiro-web-search-test"
                    title="测试搜索连接"
                    description="只发送最小搜索请求验证凭据，不发送对话或 ClassFlow 数据。"
                  >
                    <div className="flex items-center gap-2.5">
                      <SettingsButton variant="accent" onClick={runWebSearchTest} disabled={webSearchTest.status === "testing" || !webSearchEnabled}>
                        {webSearchTest.status === "testing" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Globe2 className="w-3.5 h-3.5" />
                        )}
                        测试连接
                      </SettingsButton>
                      {webSearchTest.status === "success" && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
                          <Check className="w-3.5 h-3.5" />
                          搜索服务可用
                        </span>
                      )}
                      {webSearchTest.status === "error" && (
                        <span className="text-[11px] font-semibold text-danger">{webSearchTest.message}</span>
                      )}
                    </div>
                  </SettingsRow>

                  <SettingsRow settingId="kiro-web-search-privacy" title="隐私" description="联网搜索开启时，Kiro 可能将当前搜索查询发送给搜索服务。使用自己的 API Key 时，Key 仅保存在当前浏览器会话中。">
                    <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
                      按需发送
                    </span>
                  </SettingsRow>

                  {/* ---- Task 19C1：扫描 Web PDF Vision（配置收进搜索设置，不再与搜索同级铺满） ---- */}
                  <SettingsRow
                    settingId="kiro-web-pdf-vision-enabled"
                    title="扫描 PDF 识别"
                    description="仅用于读取联网搜索发现的扫描型 PDF（无文本层页面）。"
                  >
                    <SettingsToggle
                      checked={webPdfVisionEnabled}
                      onChange={setWebPdfVisionEnabled}
                      label="扫描 PDF 识别"
                    />
                  </SettingsRow>

                  <SettingsRow
                    settingId="kiro-web-pdf-vision-model"
                    title="Vision 模型"
                    description="用于识别扫描 PDF 页面的 OpenCode Go 视觉模型。"
                  >
                    <SettingsSelect
                      value={webPdfVisionModel}
                      onChange={setWebPdfVisionModel}
                      disabled={!webPdfVisionEnabled}
                      ariaLabel="扫描 PDF Vision 模型"
                      options={getWebPdfVisionModelOptions().map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </SettingsRow>

                  <SettingsRow
                    settingId="kiro-web-pdf-vision-key"
                    title="OpenCode Go Vision API Key"
                    description="仅用于读取联网搜索发现的扫描型 PDF。密钥仅保存在当前浏览器会话中。"
                  >
                    <div className="relative w-full">
                      <SettingsInput
                        type={showWebPdfVisionKey ? "text" : "password"}
                        value={webPdfVisionApiKeyInput}
                        onChange={(v) => {
                          setWebPdfVisionApiKeyInput(v);
                          setSessionWebPdfVisionApiKey(v);
                        }}
                        placeholder="sk-..."
                        ariaLabel="OpenCode Go Vision API Key"
                        autoComplete="off"
                        spellCheck={false}
                        mono
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWebPdfVisionKey((v) => !v)}
                        aria-label={showWebPdfVisionKey ? "隐藏 Vision API Key" : "显示 Vision API Key"}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
                      >
                        {showWebPdfVisionKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </SettingsRow>
                </div>
              </DisclosureRegion>
            </>
          )}

          {/* ---- 记忆 ---- */}
          <div className="pt-1">
            <KiroMemorySettings />
          </div>
        </SettingsGroup>

        {/* ---- 高级设置：低频 capability engineering + 隐私说明，按需展开 ---- */}
        <SettingsGroup>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="text-xs font-bold text-charcoal">高级设置</span>
            <ChevronDown
              className={cn(
                "w-4 h-4 text-sandrift transition-transform duration-[var(--motion-fast)]",
                advancedOpen && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
          <DisclosureRegion open={advancedOpen}>
            <div className="px-3 pb-3 space-y-1">
              {/* 自定义 Provider 能力声明：capability engineering，使用该服务时按需配置 */}
              {isCustom && (
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
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={custom.reasoningEffort === true}
                        onChange={(e) => setCustom({ reasoningEffort: e.target.checked })}
                        className="w-3.5 h-3.5 rounded accent-charcoal"
                      />
                      支持思考程度
                    </label>
                  </div>
                </SettingsRow>
              )}

              {/* ---- 隐私与数据 ---- */}
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
            </div>
          </DisclosureRegion>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
