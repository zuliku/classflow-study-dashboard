"use client";

import React, { useState, useEffect, useRef } from "react";
import { Check, Loader2, Eye, EyeOff, PlugZap, Globe2, ChevronDown, RefreshCw } from "lucide-react";
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
import {
  getModifiedKiroSettingsPreferenceKeys,
  useKiroPreferencesStore,
  type KiroSettingsPreferences,
} from "@/store/useKiroPreferencesStore";
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
  deleteTavilyCredential,
  isWebSearchSecretStorageAvailable,
  listTavilyCredentialMetadata,
  saveTavilyCredential,
} from "@/lib/ai/web/secretStorage";
import {
  getSessionWebPdfVisionApiKey,
  setSessionWebPdfVisionApiKey,
} from "@/lib/ai/web/vision/credentials";
import { getWebPdfVisionModelOptions } from "@/lib/ai/web/vision/models";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/desktop/apiBase";
import { AI } from "@/lib/ai/config";

const PROVIDER_OPTIONS: { value: AIProviderId; label: string }[] = [
  { value: "opencode-go", label: "OpenCode Go" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom-openai", label: "自定义 OpenAI 兼容服务" },
];

const REASONING_EFFORT_LABELS: Record<KiroReasoningEffort, string> = {
  default: "默认",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极高",
};

type TestState =
  | { status: "idle" | "testing" }
  | { status: "success"; mode?: "basic" | "enhanced" }
  | { status: "error"; message: string };

/**
 * Kiro 设置（Settings V4）：让 AI 工作的基础配置（AI 服务 / 模型 / API Key / 连接测试）
 * 全部留在普通主区域；只有低频技术配置（自定义能力声明、PDF Vision）收进默认折叠的「高级设置」。
 * reveal：搜索跳转请求自动展开对应披露区（纯 UI 行为，不修改任何偏好）。
 */
export function KiroAISettings({ reveal }: { reveal?: { key: string; seq: number } | null }) {
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
  // Task 14：Kiro Search（联网搜索）——Key 经 SecretVault；Store 只存 credentialRef
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useKiroPreferencesStore((s) => s.setWebSearchEnabled);
  const webSearchCredentialMode = useKiroPreferencesStore((s) => s.webSearchCredentialMode);
  const setWebSearchCredentialMode = useKiroPreferencesStore((s) => s.setWebSearchCredentialMode);
  const webSearchCredentialRef = useKiroPreferencesStore((s) => s.webSearchCredentialRef);
  const setWebSearchCredentialRef = useKiroPreferencesStore((s) => s.setWebSearchCredentialRef);
  const webPdfVisionEnabled = useKiroPreferencesStore((s) => s.webPdfVisionEnabled);
  const setWebPdfVisionEnabled = useKiroPreferencesStore((s) => s.setWebPdfVisionEnabled);
  const webPdfVisionModel = useKiroPreferencesStore((s) => s.webPdfVisionModel);
  const setWebPdfVisionModel = useKiroPreferencesStore((s) => s.setWebPdfVisionModel);
  // 2026-09：模型选择器范围（默认精选；打开显示全部已验证模型）
  const showAllModels = useKiroPreferencesStore((s) => s.showAllModels);
  const setShowAllModels = useKiroPreferencesStore((s) => s.setShowAllModels);
  const resetKiroSettingsPreference = useKiroPreferencesStore((s) => s.resetKiroSettingsPreference);

  // V5A9：仅 Settings-facing Kiro preferences 参与 modified/reset；session key / Sidecar / permissions 排除。
  const kiroSettingsPreferences: KiroSettingsPreferences = {
    outputTextSize,
    autoContextEnabled,
    responsePreference,
    webSearchEnabled,
    webSearchCredentialMode,
    webPdfVisionEnabled,
    webPdfVisionModel,
    showAllModels,
  };
  const kiroSettingsModified = new Set(
    getModifiedKiroSettingsPreferenceKeys(kiroSettingsPreferences)
  );

  const RESPONSE_PREFERENCE_DESCRIPTIONS: Record<KiroResponsePreference, string> = {
    dense: "结论、关键事实与行动优先",
    balanced: "在结论之外补充必要原因",
    deep: "更完整的解释，必要时补充学习建议",
  };

  const [apiKeyInput, setApiKeyInput] = useState(getSessionApiKey(provider));
  const [showKey, setShowKey] = useState(false);
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);
  // 能力/高级设置默认收起（常用项优先，技术细节按需展开）
  const [searchSettingsOpen, setSearchSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 搜索跳转请求展开披露区（seq 变化即重新触发；只展开、绝不收起）
  useEffect(() => {
    if (!reveal) return;
    if (reveal.key === "search-settings") setSearchSettingsOpen(true);
    if (reveal.key === "advanced") setAdvancedOpen(true);
  }, [reveal]);

  const [webSearchApiKeyInput, setWebSearchApiKeyInput] = useState(getSessionWebSearchApiKey());
  const [webPdfVisionApiKeyInput, setWebPdfVisionApiKeyInput] = useState(getSessionWebPdfVisionApiKey());
  const [showWebPdfVisionKey, setShowWebPdfVisionKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [webSearchTest, setWebSearchTest] = useState<TestState>({ status: "idle" });
  const [serverSearchConfigured, setServerSearchConfigured] = useState<boolean | null>(null);
  const [keylessSearchAvailable, setKeylessSearchAvailable] = useState<boolean | null>(null);
  const [savingWebSearchKey, setSavingWebSearchKey] = useState(false);
  const [webSearchKeyError, setWebSearchKeyError] = useState<string | null>(null);

  // Hotfix：Server Search 配置状态（null = 检测中；不阻塞 Settings 渲染）
  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      try {
        const res = await fetch(apiUrl("/api/ai/web-search/status"));
        const data = res.ok
          ? ((await res.json()) as { serverConfigured?: boolean; keylessAvailable?: boolean } | null)
          : null;
        if (!cancelled && data) {
          if (typeof data.serverConfigured === "boolean") setServerSearchConfigured(data.serverConfigured);
          if (typeof data.keylessAvailable === "boolean") setKeylessSearchAvailable(data.keylessAvailable);
        }
      } catch {
        if (!cancelled) setServerSearchConfigured(null);
      }
    };
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, []);

  // BYOK Tavily Key：SecretVault 持久化（renderer 只保存 ref；明文绝不进 Store）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!isWebSearchSecretStorageAvailable()) return;
      const list = await listTavilyCredentialMetadata();
      if (cancelled || list === null) return;
      const currentRef = useKiroPreferencesStore.getState().webSearchCredentialRef;
      const validRef =
        currentRef && list.some((m) => m.credentialRef === currentRef)
          ? currentRef
          : (list[0]?.credentialRef ?? "");
      if (validRef !== currentRef) setWebSearchCredentialRef(validRef);
      if (validRef) return;

      // 兼容升级：已有 sessionStorage Key 时自动迁移到 SecretVault，之后请求只发 ref。
      const sessionKey = getSessionWebSearchApiKey();
      if (!sessionKey) return;
      try {
        const ref = await saveTavilyCredential(sessionKey);
        if (cancelled) return;
        setWebSearchCredentialRef(ref);
        setSessionWebSearchApiKey("");
        setWebSearchApiKeyInput("");
      } catch {
        if (!cancelled) setWebSearchKeyError("Key 安全存储失败，当前仅在本次会话有效。");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [setWebSearchCredentialRef]);

  // 统一模型 Catalog：Settings 与 Composer 共用同一模型集合（Task 10）
  const {
    models: catalogModels,
    refreshing: modelsRefreshing,
    error: modelsRefreshError,
    refresh: refreshModels,
  } = useAIModelCatalog(provider);
  const models = catalogModels;
  const isCustom = provider === "custom-openai";
  // 当前模型不在 Catalog（已下线/远端不可用）：提示重新选择，不自动覆盖；models 为空时不误报（网慢首帧）
  const modelUnavailable = !isCustom && models.length > 0 && !!model && !models.some((m) => m.id === model);
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
    // 使 in-flight 测试结果过期（runTest 落地时 seq 不匹配 → 丢弃）
    runTestSeqRef.current += 1;
    setProvider(p);
    setApiKeyInput(getSessionApiKey(p));
    setTest({ status: "idle" });
  };

  const handleApiKeyChange = (v: string) => {
    setApiKeyInput(v);
    setSessionApiKey(provider, v);
  };

  // Latest-wins seq：测试进行中切换 provider/修改配置 → 迟到的旧测试结果不得
  // 覆盖新选择的状态徽章（handleProviderChange 会重置为 idle，旧响应随后落地会误标）
  const runTestSeqRef = useRef(0);
  const webSearchSeqRef = useRef(0);

  const runTest = async () => {
    const seq = ++runTestSeqRef.current;
    setTest({ status: "testing" });
    // Sanitized logging (no API key)
    const endpointHostname = (() => {
      try {
        return new URL(AI.OPENCODE_BASE_URL).hostname;
      } catch {
        return "unknown";
      }
    })();
    if (process.env.NODE_ENV !== "production") {
      console.log(`[classflow] AI test provider=${provider} model=${model} endpoint=${endpointHostname}`);
    }
    try {
      const res = await fetch(apiUrl("/api/ai/test"), {
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
      if (seq !== runTestSeqRef.current) return; // 过期结果：丢弃（provider 已切换）
      if (process.env.NODE_ENV !== "production") {
        console.log(`[classflow] AI test status=${res.status} ok=${data.ok} code=${data.code ?? "-"} endpoint=${endpointHostname}`);
      }
      if (data.ok) setTest({ status: "success" });
      else setTest({ status: "error", message: data.message || AI_ERROR_MESSAGES[data.code ?? "UNKNOWN"] });
    } catch (err) {
      if (seq !== runTestSeqRef.current) return;
      if (process.env.NODE_ENV !== "production") {
        console.error(`[classflow] AI test provider=${provider} model=${model} endpoint=${endpointHostname} error=fetch_failed`);
      }
      setTest({ status: "error", message: AI_ERROR_MESSAGES.PROVIDER_UNAVAILABLE });
    }
  };

  /** BYOK Key：输入期间先写 sessionStorage（发送竞态兜底）；blur/测试时写入 SecretVault。 */
  const handleWebSearchKeyChange = (value: string) => {
    setWebSearchApiKeyInput(value);
    setSessionWebSearchApiKey(value);
    setWebSearchKeyError(null);
    setWebSearchTest({ status: "idle" });
  };

  /** 将当前输入保存到 SecretVault；返回可发送的 credentialRef。 */
  const persistWebSearchKey = async (): Promise<string | undefined> => {
    const trimmed = webSearchApiKeyInput.trim();
    if (!trimmed) return webSearchCredentialRef || undefined;
    setSavingWebSearchKey(true);
    setWebSearchKeyError(null);
    try {
      const ref = await saveTavilyCredential(trimmed, webSearchCredentialRef || undefined);
      setWebSearchCredentialRef(ref);
      setWebSearchApiKeyInput("");
      setSessionWebSearchApiKey("");
      return ref;
    } catch (err) {
      setWebSearchKeyError((err as Error).message || "Key 安全存储失败。");
      return webSearchCredentialRef || undefined;
    } finally {
      setSavingWebSearchKey(false);
    }
  };

  const clearWebSearchKey = async () => {
    setWebSearchKeyError(null);
    try {
      if (webSearchCredentialRef) await deleteTavilyCredential(webSearchCredentialRef);
      setWebSearchCredentialRef("");
      setWebSearchApiKeyInput("");
      setSessionWebSearchApiKey("");
      setWebSearchTest({ status: "idle" });
    } catch {
      setWebSearchKeyError("清除失败，请稍后重试。");
    }
  };

  const runWebSearchTest = async () => {
    const seq = ++webSearchSeqRef.current;
    setWebSearchTest({ status: "testing" });
    const credentialRef =
      webSearchCredentialMode === "byok" ? await persistWebSearchKey() : undefined;
    try {
      const res = await fetch(apiUrl("/api/ai/web-search/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialMode: webSearchCredentialMode,
          credentialRef,
          // 旧会话 Key 兜底：vault 保存失败时仍可验证当前输入。
          apiKey:
            webSearchCredentialMode === "byok" && !credentialRef
              ? getSessionWebSearchApiKey()
              : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        message?: string;
        mode?: "basic" | "enhanced";
      };
      if (seq !== webSearchSeqRef.current) return;
      if (data.ok) setWebSearchTest({ status: "success", mode: data.mode });
      else setWebSearchTest({ status: "error", message: data.message || "搜索服务不可用" });
    } catch {
      if (seq !== webSearchSeqRef.current) return;
      setWebSearchTest({ status: "error", message: "搜索服务不可用" });
    }
  };

  return (
    <SettingsSection
      title="Kiro"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro">
        {/* ---- Kiro ---- */}
        <SettingsGroup title="Kiro">
          <SettingsRow
            settingId="ai-enabled"
            title="启用 Kiro"
          >
            <SettingsToggle checked={enabled} onChange={setEnabled} label="启用 Kiro" />
          </SettingsRow>
        </SettingsGroup>

        {/* ---- AI 服务：provider / credential / connection（让 Kiro 工作的基础配置，不进高级设置） ---- */}
        <SettingsGroup title="AI 服务">
          <SettingsRow
            settingId="ai-provider"
            title="AI 服务"
          >
            <SettingsSelect
              value={provider}
              onChange={handleProviderChange}
              ariaLabel="AI 服务"
              options={PROVIDER_OPTIONS}
            />
          </SettingsRow>

          {!isCustom ? (
            <>
              <SettingsRow
                settingId="ai-model"
                title="模型"
              >
                <div className="flex flex-col items-end gap-1">
                  <SettingsSelect
                    value={model}
                    onChange={setModel}
                    ariaLabel="模型"
                    searchable
                    options={models.map((m) => ({ value: m.id, label: m.name }))}
                  />
                  {modelUnavailable && (
                    <span className="text-[10px] font-semibold text-danger">当前模型已不可用，请重新选择。</span>
                  )}
                  {/* 一键更新模型列表（绕过服务端短缓存；仅刷新可用性，不改 transport/能力声明） */}
                  {provider === "opencode-go" && (
                    <button
                      type="button"
                      onClick={refreshModels}
                      disabled={modelsRefreshing}
                      data-testid="ai-model-refresh"
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={cn("w-3 h-3", modelsRefreshing && "animate-spin")} />
                      {modelsRefreshing ? "正在更新模型列表…" : "更新模型列表"}
                    </button>
                  )}
                  {modelsRefreshError && (
                    <span className="text-[10px] text-danger" role="status">
                      {modelsRefreshError}
                    </span>
                  )}
                </div>
              </SettingsRow>

              {/* 2026-09：更多模型（仅 OpenCode Go；打开后模型选择器显示全部已验证模型） */}
              {provider === "opencode-go" && (
                <SettingsRow
                  settingId="kiro-show-all-models"
                  title="显示更多模型"
                  description="显示全部已验证模型。"
                  modified={kiroSettingsModified.has("showAllModels")}
                  onReset={() => resetKiroSettingsPreference("showAllModels")}
                  resetAriaLabel="将模型范围恢复默认"
                >
                  <SettingsToggle
                    checked={showAllModels}
                    onChange={setShowAllModels}
                    label="显示更多模型"
                  />
                </SettingsRow>
              )}
            </>
          ) : (
            <>
              <SettingsRow
                settingId="ai-custom-name"
                title="服务名称"
              >
                <SettingsInput
                  value={custom.providerName}
                  onChange={(v) => setCustom({ providerName: v })}
                  placeholder="如：公司网关"
                />
              </SettingsRow>
              <SettingsRow
                settingId="ai-custom-url"
                title="服务地址"
                description="OpenAI 兼容地址（https）。"
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
                title="模型 ID"
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
            settingId="ai-api-key"
            title="API Key"
            description="仅本次会话有效。"
          >
            <div className="relative w-full">
              <SettingsInput
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={handleApiKeyChange}
                placeholder="oc_sk_..."
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
          <SettingsRow settingId="ai-connection-status" title="连接状态">
            <div className="flex flex-wrap items-center justify-end gap-2.5">
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

        {/* ---- 模型与回答：model behavior（模型选择在「AI 服务」组，不重复） ---- */}
        <SettingsGroup title="模型与回答">
          <SettingsRow
            settingId="ai-reasoning-effort"
            title="思考程度"
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
            settingId="kiro-response-preference"
            title="回答偏好"
            description={RESPONSE_PREFERENCE_DESCRIPTIONS[responsePreference]}
            modified={kiroSettingsModified.has("responsePreference")}
            onReset={() => resetKiroSettingsPreference("responsePreference")}
            resetAriaLabel="将回答偏好恢复默认"
          >
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
          </SettingsRow>

          <SettingsRow
            settingId="kiro-output-text-size"
            title="输出字号"
            modified={kiroSettingsModified.has("outputTextSize")}
            onReset={() => resetKiroSettingsPreference("outputTextSize")}
            resetAriaLabel="将输出字号恢复默认"
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
        </SettingsGroup>

        {/* ---- Kiro 能力：上下文 / 联网搜索（主层开关 + summary，细节进「搜索设置」）/ 记忆 ---- */}
        <SettingsGroup title="Kiro 能力">
          <SettingsRow
            settingId="kiro-auto-context"
            title="自动环境上下文"
            description="自动带入当前页面；关闭后用 @ 添加。"
            modified={kiroSettingsModified.has("autoContextEnabled")}
            onReset={() => resetKiroSettingsPreference("autoContextEnabled")}
            resetAriaLabel="将自动环境上下文恢复默认"
          >
            <SettingsToggle
              checked={autoContextEnabled}
              onChange={setAutoContextEnabled}
              label="自动环境上下文"
            />
          </SettingsRow>

          <SettingsRow
            settingId="kiro-web-search-enabled"
            title="联网搜索"
            description={
              webSearchCredentialMode === "server"
                ? serverSearchConfigured === true
                  ? "需要最新信息时自动搜索；多角度问题自动深入检索；Tavily 增强已启用。"
                  : keylessSearchAvailable === false
                    ? "需要最新信息时自动搜索；当前基础搜索不可用。"
                    : "需要最新信息时自动搜索；多角度问题自动深入检索；基础搜索免 Key。"
                : "需要最新信息时自动搜索；多角度问题自动深入检索；使用自己的 Tavily Key。"
            }
            modified={kiroSettingsModified.has("webSearchEnabled")}
            onReset={() => resetKiroSettingsPreference("webSearchEnabled")}
            resetAriaLabel="将联网搜索恢复默认"
          >
            <SettingsToggle
              checked={webSearchEnabled}
              onChange={(enabled) => {
                setWebSearchEnabled(enabled);
                // 关闭时同时收起细节，避免下次开启瞬间弹出一大段造成跳变。
                if (!enabled) setSearchSettingsOpen(false);
              }}
              label="联网搜索"
            />
          </SettingsRow>

          {/* 外层折叠：开关关闭时整段设置收起；内容首行就是「搜索设置」，不再用负 margin 硬顶 */}
          <DisclosureRegion open={webSearchEnabled}>
              <div className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSearchSettingsOpen((v) => !v)}
                  aria-expanded={searchSettingsOpen}
                  className="w-full flex items-center justify-between gap-3 min-h-[52px] py-3 text-left transition-colors hover:text-charcoal"
                >
                  <span className="text-xs font-bold text-charcoal">搜索设置</span>
                  <span className="flex items-center gap-2 text-[11px] text-sandrift">
                    {webSearchCredentialMode === "server"
                      ? serverSearchConfigured === true
                        ? "增强搜索"
                        : keylessSearchAvailable === false
                          ? "不可用"
                          : "基础搜索"
                      : "自己的 Key"}
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)]",
                        searchSettingsOpen && "rotate-180"
                      )}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                <DisclosureRegion open={searchSettingsOpen}>
                  <div className="pb-1">
                    <SettingsRow
                      settingId="kiro-web-search-service"
                      title="搜索服务"
                      description={
                        webSearchCredentialMode === "server"
                          ? serverSearchConfigured === true
                            ? "Tavily 增强搜索"
                            : keylessSearchAvailable === false
                              ? "基础搜索不可用"
                              : "免 Key 基础搜索"
                          : "自己的 Tavily Key"
                      }
                    >
                      <span className="px-2 py-0.5 rounded-full bg-pastel-mint text-[10px] font-bold text-charcoal shrink-0">
                        Kiro Search
                      </span>
                    </SettingsRow>

                    <SettingsRow
                      settingId="kiro-web-search-credential"
                      title="凭据"
                      description={
                        webSearchCredentialMode === "server"
                          ? serverSearchConfigured === true
                            ? "自动使用已配置的 Tavily 增强搜索。"
                            : keylessSearchAvailable === false
                              ? "基础搜索不可用；请使用自己的 Tavily Key。"
                              : "自动使用基础搜索；配置自己的 Tavily Key 可提高额度与稳定性。"
                          : "Key 保存在本机安全存储；不会进入备份。"
                      }
                      modified={kiroSettingsModified.has("webSearchCredentialMode")}
                      onReset={() => resetKiroSettingsPreference("webSearchCredentialMode")}
                      resetAriaLabel="将搜索凭据恢复默认"
                    >
                      <SettingsSegmentedControl<"server" | "byok">
                        value={webSearchCredentialMode}
                        onChange={(v) => {
                          setWebSearchCredentialMode(v);
                          setWebSearchTest({ status: "idle" });
                        }}
                        ariaLabel="Kiro Search 凭据"
                        options={[
                          { value: "server", label: "自动（推荐）" },
                          { value: "byok", label: "自己的 Tavily Key" },
                        ]}
                      />
                    </SettingsRow>

                  <DisclosureRegion open={webSearchCredentialMode === "byok"}>
                    <SettingsRow
                      settingId="kiro-web-search-byok-key"
                      title="Tavily API Key"
                      description="保存在本机安全存储；已保存的 Key 不会再次显示。"
                    >
                      <div className="flex flex-col gap-1 w-full">
                        <div className="relative w-full">
                          <SettingsInput
                            type={showWebSearchKey ? "text" : "password"}
                            value={webSearchApiKeyInput}
                            onChange={handleWebSearchKeyChange}
                            onBlur={() => {
                              if (webSearchApiKeyInput.trim()) void persistWebSearchKey();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && webSearchApiKeyInput.trim()) {
                                event.preventDefault();
                                void persistWebSearchKey();
                              }
                            }}
                            placeholder={
                              webSearchCredentialRef
                                ? "已保存到本机安全存储（输入新 Key 可替换）"
                                : "tvly-..."
                            }
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
                        <div className="min-h-[16px] text-[10px] leading-4 text-sandrift">
                          {savingWebSearchKey ? (
                            <span>正在保存到本机安全存储…</span>
                          ) : webSearchKeyError ? (
                            <span className="font-semibold text-danger">{webSearchKeyError}</span>
                          ) : webSearchCredentialRef && !webSearchApiKeyInput ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>已保存到本机安全存储。</span>
                              <button
                                type="button"
                                onClick={() => void clearWebSearchKey()}
                                className="font-semibold hover:text-danger transition-colors"
                              >
                                清除
                              </button>
                            </div>
                          ) : !isWebSearchSecretStorageAvailable() ? (
                            <span>桌面安全存储不可用；Key 仅本次会话有效。</span>
                          ) : null}
                        </div>
                      </div>
                    </SettingsRow>
                  </DisclosureRegion>

                  <SettingsRow
                    settingId="kiro-web-search-test"
                    title="测试搜索连接"
                  >
                    <div className="flex flex-wrap items-center justify-end gap-2.5">
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
                          {webSearchTest.mode === "basic"
                            ? "基础搜索可用"
                            : webSearchTest.mode === "enhanced"
                              ? "增强搜索可用"
                              : "搜索服务可用"}
                        </span>
                      )}
                      {webSearchTest.status === "error" && (
                        <span className="text-[11px] font-semibold text-danger">{webSearchTest.message}</span>
                      )}
                    </div>
                  </SettingsRow>

                  <SettingsRow
                    settingId="kiro-web-search-privacy"
                    title="隐私"
                    description="只发送搜索关键词给当前使用的第三方搜索服务；不会发送对话全文、文件或本地数据。"
                  >
                    <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
                      按需发送
                    </span>
                  </SettingsRow>
                </div>
                </DisclosureRegion>
              </div>
          </DisclosureRegion>

          {/* ---- 记忆 ---- */}
          <div className="pt-1">
            <KiroMemorySettings />
          </div>
        </SettingsGroup>

        {/* ---- 高级设置：低频技术配置，默认折叠 ---- */}
        <SettingsGroup>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="w-full flex items-center justify-between gap-3 min-h-[52px] py-3 text-left border-b border-line-soft last:border-b-0"
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
            <div className="pb-1 space-y-1">
              {/* 自定义 Provider 能力声明：capability engineering，使用该服务时按需配置 */}
              {isCustom && (
                <SettingsRow
                  settingId="ai-custom-capabilities"
                  title="模型能力"
                   description="仅在兼容服务支持时开启。"
                >
                  <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-satin-grey">
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

              {/* ---- Task 19C1：扫描 Web PDF Vision（低频技术配置，收进高级设置；开关切换折叠进退） ---- */}
              <DisclosureRegion open={webSearchEnabled}>
                  <SettingsRow
                    settingId="kiro-web-pdf-vision-enabled"
                    title="扫描 PDF 识别"
                    description="用于读取联网搜索中的扫描型 PDF。"
                    modified={kiroSettingsModified.has("webPdfVisionEnabled")}
                    onReset={() => resetKiroSettingsPreference("webPdfVisionEnabled")}
                    resetAriaLabel="将扫描 PDF 识别恢复默认"
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
                    modified={kiroSettingsModified.has("webPdfVisionModel")}
                    onReset={() => resetKiroSettingsPreference("webPdfVisionModel")}
                    resetAriaLabel="将 Vision 模型恢复默认"
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
                  >
                    <div className="relative w-full">
                      <SettingsInput
                        type={showWebPdfVisionKey ? "text" : "password"}
                        value={webPdfVisionApiKeyInput}
                        onChange={(v) => {
                          setWebPdfVisionApiKeyInput(v);
                          setSessionWebPdfVisionApiKey(v);
                        }}
                        placeholder="oc_sk_..."
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
              </DisclosureRegion>
            </div>
          </DisclosureRegion>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
