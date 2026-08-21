"use client";

import React, { useEffect, useState, useCallback } from "react";
import { MessageSquare, Plus, Plug2, Trash2, Power, TestTube2, Settings2, Mail, RefreshCw, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { ChannelBrandIcon } from "@/components/icons/ChannelBrandIcon";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { cn } from "@/lib/utils";

type QQConfig = { id: string; channel: "qq-bot"; displayName: string; appId: string; credentialRef: string; enabled: boolean; requireMentionInGroup: boolean; allowedUsers: string[]; allowedGroups: string[]; receiveDirectMessages: boolean; receiveGroupMessages: boolean };
type GmailConfig = { id: string; channel: "gmail"; displayName: string; emailAddress: string; credentialRef: string; enabled: boolean; syncIntervalSeconds: 60 };
type QQMailConfig = { id: string; channel: "qq-mail"; displayName: string; emailAddress: string; credentialRef: string; enabled: boolean; syncIntervalSeconds: 60 };
type GenericChannelConfig = QQConfig | GmailConfig | QQMailConfig;
type ChannelStatus = { config: GenericChannelConfig; health: { channel: string; id: string; state: string; accountId?: string; lastError?: { code: string; message: string }; messageCount?: number } };

function getChannelsBridge(): {
  list: () => Promise<{ channels: ChannelStatus[] }>;
  addQQ: (input: unknown) => Promise<{ channel: unknown }>;
  update: (input: unknown) => Promise<unknown>;
  setEnabled: (input: unknown) => Promise<unknown>;
  connect: (input: unknown) => Promise<unknown>;
  disconnect: (input: unknown) => Promise<unknown>;
  test: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
  remove: (input: unknown) => Promise<unknown>;
  startGmailOAuth: () => Promise<{ channel: unknown }>;
  syncNow: (input: unknown) => Promise<{ added: number; durationMs: number }>;
} | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { classflowDesktop?: { channels?: unknown } }).classflowDesktop?.channels as never;
  return bridge ?? null;
}

function getCredentialsBridge(): { create: (input: unknown) => Promise<{ credentialRef: string }>; replace: (input: unknown) => Promise<unknown>; delete: (input: unknown) => Promise<unknown> } | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { classflowDesktop?: { credentials?: unknown } }).classflowDesktop?.credentials as never;
  return bridge ?? null;
}

function stateLabel(state: string): string {
  switch (state) {
    case "connected": return "已连接";
    case "connecting": return "连接中";
    case "reconnecting": return "正在重连";
    case "error": return "错误";
    case "disabled": return "已停用";
    case "disconnected": return "已断开";
    default: return state;
  }
}

function stateColor(state: string): string {
  if (state === "connected") return "bg-success/10 text-success border-success/20";
  if (state === "error") return "bg-danger/10 text-danger border-danger/20";
  if (state === "connecting" || state === "reconnecting") return "bg-warning-bg text-warning border-warning-border";
  return "bg-surface-soft text-satin-grey border-line";
}

export function ChannelSettings() {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ChannelStatus | null>(null);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const pushToast = useToastStore((s) => s.pushToast);

  const isBusy = (id: string, action: string) => !!busyMap[`${id}:${action}`];
  const setBusy = (id: string, action: string, v: boolean) => setBusyMap((prev) => ({ ...prev, [`${id}:${action}`]: v }));

  const refresh = useCallback(async () => {
    const bridge = getChannelsBridge();
    if (!bridge) { setLoading(false); return; }
    try {
      const res = await bridge.list() as { channels: ChannelStatus[] };
      setChannels(Array.isArray(res.channels) ? res.channels : []);
    } catch { setChannels([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleConnect = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    setBusy(id, "connect", true);
    try { await b.connect({ id }); await refresh(); pushToast({ message: "已连接", type: "success" }); } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "connect", false); }
  };
  const handleDisconnect = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    setBusy(id, "disconnect", true);
    try { await b.disconnect({ id }); await refresh(); pushToast({ message: "已断开", type: "success" }); } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "disconnect", false); }
  };
  const handleTest = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    setBusy(id, "test", true);
    try {
      const res = await b.test({ id }) as { ok: boolean; error?: string };
      pushToast({ message: res.ok ? "连接正常" : `测试失败：${res.error ?? "未知"}`, type: res.ok ? "success" : "error" });
    } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "test", false); }
  };
  const handleSyncNow = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    setBusy(id, "sync", true);
    try {
      const res = await b.syncNow({ id }) as { added: number; durationMs: number };
      pushToast({ message: `已同步，新增 ${res.added} 封邮件`, type: "success" });
      await refresh();
    } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "sync", false); }
  };
  const handleRemove = async (id: string, displayName: string) => {
    const cfg = channels.find(c => c.config.id === id)?.config;
    const typeLabel = cfg?.channel === "gmail" ? "Gmail 账号" : cfg?.channel === "qq-mail" ? "QQ 邮箱账号" : "QQ Bot 配置";
    useConfirmStore.getState().confirm({
      title: `删除「${displayName}」？`,
      description: `确定删除该${typeLabel}「${displayName}」？删除后无法恢复。`,
      danger: true,
      confirmLabel: "删除",
      onConfirm: async () => {
        setBusy(id, "remove", true);
        const b = getChannelsBridge(); if (!b) { setBusy(id, "remove", false); return; }
        try { await b.remove({ id }); await refresh(); pushToast({ message: "已删除", type: "success" }); } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "remove", false); }
      },
    });
  };
  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    const b = getChannelsBridge(); if (!b) return;
    setBusy(id, "toggle", true);
    try { await b.setEnabled({ id, enabled }); await refresh(); pushToast({ message: enabled ? "已启用" : "已停用", type: "success" }); } catch (e) { pushToast({ message: (e as { message?: string })?.message ?? String(e), type: "error" }); } finally { setBusy(id, "toggle", false); }
  };

  if (loading) return <p className="text-xs text-sandrift">加载中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-charcoal">消息渠道</h3>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} data-testid="channel-add" data-channel-add="generic">
          <Plus className="w-3.5 h-3.5" />添加渠道
        </Button>
        {/* Legacy test id kept for backward compat */}
        <span data-testid="channel-add-qq" className="hidden" />
      </div>

      {channels.length === 0 ? (
        <div className="p-6 flex flex-col items-center text-center gap-3 bg-surface border border-line rounded-xl">
          <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-charcoal" />
          </div>
          <div>
            <p className="text-sm font-bold text-charcoal">还没有消息渠道</p>
            <p className="text-xs text-sandrift mt-1">添加 QQ Bot、Gmail 或 QQ 邮箱后，消息将进入统一收件箱（receive-only，不自动触发 Kiro）</p>
          </div>
          <div className="flex gap-2 mt-2">
            <span className="px-2 py-1 bg-white border border-line rounded-lg text-[11px] font-bold">QQ Bot</span>
            <span className="px-2 py-1 bg-white border border-line rounded-lg text-[11px] font-bold">Gmail</span>
            <span className="px-2 py-1 bg-white border border-line rounded-lg text-[11px] font-bold">QQ 邮箱</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map(({ config, health }) => (
            <div key={config.id} data-testid={`channel-card-${config.id}`} data-channel-type={config.channel} className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 transition-[border-color,background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:border-line-strong hover:bg-surface-soft/30 animate-enter">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-alabaster border border-line flex items-center justify-center shrink-0 mt-0.5">
                    <ChannelBrandIcon source={config.channel as never} size={20} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-charcoal truncate">{config.displayName}</h4>
                    {config.channel === "qq-bot" ? (
                      <p className="text-xs text-sandrift truncate">App ID: {(config as QQConfig).appId} · {(config as QQConfig).receiveDirectMessages ? "接收私聊" : "不接收私聊"} · {(config as QQConfig).receiveGroupMessages ? "接收群聊" : "不接收群聊"} {(config as QQConfig).requireMentionInGroup ? "· 群聊需 @" : ""}</p>
                    ) : config.channel === "gmail" ? (
                      <p className="text-xs text-sandrift truncate">Gmail · {(config as GmailConfig).emailAddress}</p>
                    ) : (
                      <p className="text-xs text-sandrift truncate">QQ 邮箱 · {(config as QQMailConfig).emailAddress}</p>
                    )}
                    {config.channel === "qq-bot" && (
                      <p className="text-[11px] text-sandrift mt-1">允许用户: {(config as QQConfig).allowedUsers.length ? (config as QQConfig).allowedUsers.join(", ") : "不限制"} · 允许群: {(config as QQConfig).allowedGroups.length ? (config as QQConfig).allowedGroups.join(", ") : "不限制"}</p>
                    )}
                    {health.lastError && <p className="text-[11px] text-danger mt-1">错误: {health.lastError.code} {health.lastError.message}</p>}
                  </div>
                </div>
                <span className={cn("shrink-0 px-2 py-1 rounded-full text-[11px] font-bold border transition-[background-color,border-color,color,opacity] duration-[var(--motion-fast)] ease-[var(--ease-standard)]", stateColor(health.state))}>{stateLabel(health.state)}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {config.channel === "qq-bot" ? (
                  <Button variant="secondary" size="sm" onClick={() => setEditTarget({ config, health })} data-testid={`channel-edit-${config.id}`}> <Settings2 className="w-3 h-3" />配置</Button>
                ) : null}
                <Button variant="secondary" size="sm" loading={isBusy(config.id, "test")} loadingLabel="正在测试" onClick={() => handleTest(config.id)} data-testid={`channel-test-${config.id}`}><TestTube2 className="w-3 h-3" />{config.channel === "qq-bot" ? "测试连接" : "测试"}</Button>
                {(config.channel === "gmail" || config.channel === "qq-mail") && (
                  <Button variant="secondary" size="sm" loading={isBusy(config.id, "sync")} loadingLabel="正在同步" onClick={() => handleSyncNow(config.id)} data-testid={`channel-sync-${config.id}`}><RefreshCw className="w-3 h-3" />立即同步</Button>
                )}
                {health.state === "connected" ? (
                  <Button variant="secondary" size="sm" loading={isBusy(config.id, "disconnect")} loadingLabel="断开中" onClick={() => handleDisconnect(config.id)} data-testid={`channel-disconnect-${config.id}`}><Power className="w-3 h-3" />断开</Button>
                ) : (
                  <Button variant="primary" size="sm" loading={isBusy(config.id, "connect")} loadingLabel="正在连接" onClick={() => handleConnect(config.id)} data-testid={`channel-connect-${config.id}`}><Plug2 className="w-3 h-3" />连接</Button>
                )}
                <Button variant="secondary" size="sm" loading={isBusy(config.id, "remove")} onClick={() => handleRemove(config.id, config.displayName)} data-testid={`channel-remove-${config.id}`} className="text-danger hover:bg-danger-bg"><Trash2 className="w-3 h-3" /></Button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-sandrift">启用</span>
                  <Switch checked={config.enabled} onChange={(v) => handleToggleEnabled(config.id, v)} label="启用" disabled={isBusy(config.id, "toggle")} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} onAdded={refresh} />
      {editTarget && editTarget.config.channel === "qq-bot" && <EditQQDialog target={editTarget as unknown as { config: QQConfig; health: ChannelStatus["health"] }} onOpenChange={(o) => !o && setEditTarget(null)} onSaved={refresh} />}
    </div>
  );
}

export function AddChannelDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const [provider, setProvider] = useState<"qq-bot" | "gmail" | "qq-mail">("qq-bot");
  const [busy, setBusy] = useState(false);

  // Reset to qq-bot on next open (after exit animation, not during close)
  useEffect(() => {
    if (open) {
      // defer to next tick to avoid closing-frame flash
      const id = setTimeout(() => {
        if (!busy) setProvider("qq-bot");
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open, busy]);

  // Also clear busy when dialog closes (safety)
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
      overlayId="channel-add"
      aria-label="添加渠道"
      closeOnBackdrop={!busy}
      onEscapeKeyDown={(e) => {
        if (busy) e.preventDefault();
      }}
      className="w-[min(560px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center"><Plus className="w-4 h-4" /></div>
          <div><h4 className="text-sm font-bold text-charcoal">添加渠道</h4><p className="text-[11px] text-sandrift">选择要连接的消息渠道</p></div>
        </div>
        <button
          type="button"
          aria-label="关闭添加渠道"
          data-testid="channel-add-close"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] disabled:opacity-40 disabled:cursor-not-allowed ux-press"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setProvider("qq-bot")} data-testid="provider-qq-bot" className={cn("flex-1 h-10 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-[background-color,border-color,color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press", provider === "qq-bot" ? "bg-charcoal text-white border-charcoal" : "bg-white border-line text-charcoal hover:bg-alabaster")}> <MessageSquare className="w-4 h-4" />QQ Bot</button>
        <button type="button" onClick={() => setProvider("gmail")} data-testid="provider-gmail" className={cn("flex-1 h-10 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-[background-color,border-color,color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press", provider === "gmail" ? "bg-charcoal text-white border-charcoal" : "bg-white border-line text-charcoal hover:bg-alabaster")}> <Mail className="w-4 h-4" />Gmail</button>
        <button type="button" onClick={() => setProvider("qq-mail")} data-testid="provider-qq-mail" className={cn("flex-1 h-10 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-[background-color,border-color,color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press", provider === "qq-mail" ? "bg-charcoal text-white border-charcoal" : "bg-white border-line text-charcoal hover:bg-alabaster")}> <Mail className="w-4 h-4" />QQ 邮箱</button>
      </div>
      <div className="border-t border-line pt-4">
        <div key={provider} className="ux-channel-provider-enter">
          {provider === "qq-bot" ? (
            <AddQQPanel onAdded={() => { onAdded(); onOpenChange(false); }} onBusyChange={setBusy} />
          ) : provider === "gmail" ? (
            <AddGmailPanel onAdded={() => { onAdded(); onOpenChange(false); }} onBusyChange={setBusy} />
          ) : (
            <AddQQMailPanel onAdded={() => { onAdded(); onOpenChange(false); }} onBusyChange={setBusy} />
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <button
          type="button"
          data-testid="channel-add-cancel"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press"
        >
          取消
        </button>
      </div>
    </Dialog>
  );
}

function AddQQPanel({ onAdded, onBusyChange }: { onAdded: () => void; onBusyChange?: (b: boolean) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [receiveDirectMessages, setReceiveDirectMessages] = useState(true);
  const [receiveGroupMessages, setReceiveGroupMessages] = useState(true);
  const [requireMentionInGroup, setRequireMentionInGroup] = useState(true);
  const [allowedUsers, setAllowedUsers] = useState("");
  const [allowedGroups, setAllowedGroups] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDisplayName(""); setAppId(""); setAppSecret(""); setError(null); }, []);

  const handleSave = async () => {
    setError(null);
    if (!displayName.trim() || !appId.trim() || !appSecret.trim()) { setError("名称 / App ID / App Secret 必填"); return; }
    if (!/^\d+$/.test(appId.trim())) { setError("App ID 必须为数字"); return; }
    const credBridge = getCredentialsBridge();
    const chBridge = getChannelsBridge();
    if (!credBridge || !chBridge) { setError("桌面环境不可用"); return; }
    setSaving(true);
    onBusyChange?.(true);
    let credentialRef: string | null = null;
    try {
      const credRes = await credBridge.create({ provider: "qq-bot", label: displayName.trim(), secret: appSecret }) as { credentialRef: string };
      credentialRef = credRes.credentialRef;
      await chBridge.addQQ({
        displayName: displayName.trim(),
        appId: appId.trim(),
        credentialRef,
        receiveDirectMessages,
        receiveGroupMessages,
        requireMentionInGroup,
        allowedUsers: allowedUsers.split(",").map((s) => s.trim()).filter(Boolean),
        allowedGroups: allowedGroups.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setAppSecret("");
      onAdded();
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
      if (credentialRef) {
        try { await (credBridge as unknown as { delete: (i: unknown) => Promise<unknown> }).delete({ credentialRef }); } catch {}
      }
    } finally { setSaving(false); onBusyChange?.(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-charcoal"><ChannelBrandIcon source="qq-bot" size={16} />QQ Bot 配置</div>
      <div><label className="text-xs font-bold text-charcoal">名称 *</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的 QQ 机器人" data-testid="qq-add-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      <div><label className="text-xs font-bold text-charcoal">App ID *</label><input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456789" data-testid="qq-add-appid" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      <div><label className="text-xs font-bold text-charcoal">App Secret *</label><input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="••••••••" data-testid="qq-add-secret" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /><p className="text-[11px] text-sandrift mt-1">仅存于 SecretVault，关闭后不保留明文</p></div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveDirectMessages} onChange={(e) => setReceiveDirectMessages(e.target.checked)} /> 接收私聊</label>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveGroupMessages} onChange={(e) => setReceiveGroupMessages(e.target.checked)} /> 接收群聊</label>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={requireMentionInGroup} onChange={(e) => setRequireMentionInGroup(e.target.checked)} /> 群聊需 @</label>
      </div>
      <div><label className="text-xs font-bold text-charcoal">允许用户 QQ / OpenID (逗号分隔，空=不限制)</label><input value={allowedUsers} onChange={(e) => setAllowedUsers(e.target.value)} placeholder="user1, user2" data-testid="qq-add-allowed-users" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      <div><label className="text-xs font-bold text-charcoal">允许群 ID (逗号分隔)</label><input value={allowedGroups} onChange={(e) => setAllowedGroups(e.target.value)} placeholder="group1, group2" data-testid="qq-add-allowed-groups" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      {error && <p data-testid="qq-add-error" className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2 animate-enter">{error}</p>}
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button type="button" onClick={handleSave} disabled={saving} data-testid="qq-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press">{saving ? "保存中..." : "保存"}</button>
      </div>
    </div>
  );
}

function AddGmailPanel({ onAdded, onBusyChange }: { onAdded: () => void; onBusyChange?: (b: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    const bridge = getChannelsBridge();
    if (!bridge) { setError("桌面环境不可用"); return; }
    setSaving(true);
    onBusyChange?.(true);
    try {
      await bridge.startGmailOAuth();
      onAdded();
    } catch (e) {
      const raw = (e as { code?: string; message?: string })?.message ?? String(e);
      const code = (e as { code?: string })?.code ?? "";
      if (code === "GMAIL_OAUTH_CONFIG_MISSING") setError(process.env.NODE_ENV === "development" ? "Gmail OAuth 未配置（开发环境需设置 CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID）" : "Gmail 授权服务暂不可用，请稍后重试。");
      else if (code === "GMAIL_OAUTH_DENIED") setError("已拒绝授权");
      else if (code === "GMAIL_OAUTH_TIMEOUT") setError("授权超时，请重试");
      else setError(raw);
    } finally { setSaving(false); onBusyChange?.(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-bold text-charcoal"><ChannelBrandIcon source="gmail" size={16} />Gmail 账号</div>
      <div className="bg-surface-soft border border-line rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold text-charcoal">连接 Gmail</p>
        <p className="text-[11px] text-sandrift">将打开浏览器完成 Google 授权，仅请求读取和发送邮件权限。</p>
        <ul className="text-[11px] text-sandrift list-disc ml-4 space-y-1">
          <li>首次同步最近 7 天邮件，最多 50 封</li>
          <li>之后每分钟自动同步</li>
          <li>附件仅显示基本信息，不会自动下载</li>
          <li>回复仅回复发件人，保持原线程</li>
        </ul>
      </div>
      {error && <p data-testid="gmail-add-error" className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2 animate-enter">{error}</p>}
      <button type="button" onClick={handleConnect} disabled={saving} data-testid="gmail-connect-oauth" className="w-full h-10 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press">
        <Mail className="w-4 h-4" />{saving ? "正在打开授权页面…" : "连接 Gmail"}
      </button>
      {process.env.NODE_ENV === "development" && (
        <p className="text-[11px] text-sandrift text-center">开发环境可通过 CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID 覆盖内置授权配置。</p>
      )}
    </div>
  );
}

function AddQQMailPanel({ onAdded, onBusyChange }: { onAdded: () => void; onBusyChange?: (b: boolean) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDisplayName(""); setEmailAddress(""); setAuthCode(""); setError(null); }, []);

  const handleSave = async () => {
    setError(null);
    if (!displayName.trim() || !emailAddress.trim() || !authCode.trim()) { setError("名称 / QQ 邮箱地址 / 授权码 必填"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim())) { setError("邮箱地址格式不正确"); return; }
    const credBridge = getCredentialsBridge();
    const chBridge = getChannelsBridge();
    if (!credBridge || !chBridge) { setError("桌面环境不可用"); return; }
    setSaving(true);
    onBusyChange?.(true);
    let credentialRef: string | null = null;
    try {
      const credRes = await credBridge.create({ provider: "qq-mail", label: emailAddress.trim(), secret: authCode }) as { credentialRef: string };
      credentialRef = credRes.credentialRef;
      await (chBridge as unknown as { addQQMail: (i: unknown) => Promise<unknown> }).addQQMail({
        displayName: displayName.trim(),
        emailAddress: emailAddress.trim(),
        credentialRef,
      });
      setAuthCode("");
      onAdded();
    } catch (e) {
      const raw = (e as { message?: string })?.message ?? String(e);
      const code = (e as { code?: string })?.code ?? "";
      if (code === "QQ_MAIL_AUTH_FAILED") setError("QQ 邮箱认证失败，请检查邮箱地址/授权码");
      else setError(raw);
      if (credentialRef) {
        try { await (credBridge as unknown as { delete: (i: unknown) => Promise<unknown> }).delete({ credentialRef }); } catch {}
      }
    } finally { setSaving(false); onBusyChange?.(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-charcoal"><ChannelBrandIcon source="qq-mail" size={16} />QQ 邮箱配置</div>
      <div><label className="text-xs font-bold text-charcoal">名称 *</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的 QQ 邮箱" data-testid="qqmail-add-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      <div><label className="text-xs font-bold text-charcoal">QQ 邮箱地址 *</label><input value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="example@qq.com" data-testid="qqmail-add-email" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
      <div><label className="text-xs font-bold text-charcoal">授权码 *</label><input type="password" value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="请输入 QQ 邮箱授权码，不是 QQ 登录密码" data-testid="qqmail-add-authcode" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /><p className="text-[11px] text-sandrift mt-1">请输入 QQ 邮箱授权码，不是 QQ 登录密码。仅存于 SecretVault，关闭后不保留明文</p></div>
      <div className="bg-surface-soft border border-line rounded-xl p-3 space-y-1">
        <p className="text-[11px] text-sandrift">仅读取收件箱 · 首次同步最近 7 天最多 50 封 · 之后每分钟自动同步 · 附件仅显示基本信息，不会自动下载</p>
        <p className="text-[11px] text-sandrift">获取授权码：QQ 邮箱 → 设置 → 账户 → 生成授权码</p>
      </div>
      {error && <p data-testid="qqmail-add-error" className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2 animate-enter">{error}</p>}
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button type="button" onClick={handleSave} disabled={saving} data-testid="qqmail-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ux-press">{saving ? "保存中..." : "保存"}</button>
      </div>
    </div>
  );
}

function EditQQDialog({ target, onOpenChange, onSaved }: { target: { config: QQConfig; health: ChannelStatus["health"] }; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(target.config.displayName);
  const [requireMentionInGroup, setRequireMentionInGroup] = useState(target.config.requireMentionInGroup);
  const [receiveDirectMessages, setReceiveDirectMessages] = useState(target.config.receiveDirectMessages);
  const [receiveGroupMessages, setReceiveGroupMessages] = useState(target.config.receiveGroupMessages);
  const [allowedUsers, setAllowedUsers] = useState(target.config.allowedUsers.join(", "));
  const [allowedGroups, setAllowedGroups] = useState(target.config.allowedGroups.join(", "));
  const [newSecret, setNewSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    const chBridge = getChannelsBridge();
    const credBridge = getCredentialsBridge();
    if (!chBridge) { setError("桌面环境不可用"); return; }
    setSaving(true);
    const oldRef = target.config.credentialRef;
    let newRef: string | null = null;
    let credentialRef = oldRef;
    try {
      if (newSecret.trim()) {
        if (!credBridge) throw new Error("凭据服务不可用");
        const created = (await credBridge.create({ provider: "qq-bot", label: displayName.trim(), secret: newSecret.trim() })) as { credentialRef: string };
        newRef = created.credentialRef;
        credentialRef = newRef;
      }
      await chBridge.update({
        id: target.config.id,
        patch: {
          displayName: displayName.trim(),
          requireMentionInGroup,
          receiveDirectMessages,
          receiveGroupMessages,
          allowedUsers: allowedUsers.split(",").map((s) => s.trim()).filter(Boolean),
          allowedGroups: allowedGroups.split(",").map((s) => s.trim()).filter(Boolean),
          credentialRef,
        },
      });
      if (newRef) setNewSecret("");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      if (newRef) {
        try {
          await credBridge!.delete({ credentialRef: newRef });
        } catch {}
      }
      setError((e as { message?: string })?.message ?? String(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange} overlayId="channel-edit-qq" aria-label="编辑 QQ Bot" className="w-[min(520px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center"><ChannelBrandIcon source="qq-bot" size={18} /></div>
        <div><h4 className="text-sm font-bold text-charcoal">编辑 QQ Bot</h4><p className="text-[11px] text-sandrift">App ID: {target.config.appId}</p></div>
      </div>
      <div className="space-y-3">
        <div><label className="text-xs font-bold text-charcoal">名称</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="qq-edit-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
        <div><label className="text-xs font-bold text-charcoal">App Secret</label><input type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder="已安全保存（留空则不修改）" data-testid="qq-edit-secret" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /><p className="text-[11px] text-sandrift mt-1">输入新 Secret 将替换旧凭据</p></div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveDirectMessages} onChange={(e) => setReceiveDirectMessages(e.target.checked)} /> 接收私聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveGroupMessages} onChange={(e) => setReceiveGroupMessages(e.target.checked)} /> 接收群聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={requireMentionInGroup} onChange={(e) => setRequireMentionInGroup(e.target.checked)} /> 群聊需 @</label>
        </div>
        <div><label className="text-xs font-bold text-charcoal">允许用户</label><input value={allowedUsers} onChange={(e) => setAllowedUsers(e.target.value)} data-testid="qq-edit-allowed-users" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
        <div><label className="text-xs font-bold text-charcoal">允许群</label><input value={allowedGroups} onChange={(e) => setAllowedGroups(e.target.value)} data-testid="qq-edit-allowed-groups" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm focus:outline-none focus:border-charcoal transition-colors duration-[var(--motion-fast)]" /></div>
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2 animate-enter">{error}</p>}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster transition-colors duration-[var(--motion-fast)] ux-press">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} data-testid="qq-edit-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60 transition-colors duration-[var(--motion-fast)] ux-press">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </Dialog>
  );
}
