"use client";

import React, { useEffect, useState, useCallback } from "react";
import { MessageSquare, Plus, Plug2, Trash2, Power, TestTube2, Settings2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

type ChannelStatus = { config: { id: string; displayName: string; appId: string; credentialRef: string; enabled: boolean; requireMentionInGroup: boolean; allowedUsers: string[]; allowedGroups: string[]; receiveDirectMessages: boolean; receiveGroupMessages: boolean }; health: { state: string; lastError?: { code: string; message: string } } };

function getChannelsBridge(): {
  list: () => Promise<{ channels: ChannelStatus[] }>;
  addQQ: (input: unknown) => Promise<{ channel: unknown }>;
  update: (input: unknown) => Promise<unknown>;
  setEnabled: (input: unknown) => Promise<unknown>;
  connect: (input: unknown) => Promise<unknown>;
  disconnect: (input: unknown) => Promise<unknown>;
  test: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
  remove: (input: unknown) => Promise<unknown>;
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
  if (state === "connecting" || state === "reconnecting") return "bg-amber-500/10 text-amber-700 border-amber-500/20";
  return "bg-[#F7F5F5] text-satin-grey border-line";
}

export function ChannelSettings() {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ChannelStatus | null>(null);

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
    try { await b.connect({ id }); await refresh(); } catch (e) { alert((e as { message?: string })?.message ?? String(e)); }
  };
  const handleDisconnect = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    try { await b.disconnect({ id }); await refresh(); } catch (e) { alert((e as { message?: string })?.message ?? String(e)); }
  };
  const handleTest = async (id: string) => {
    const b = getChannelsBridge(); if (!b) return;
    try {
      const res = await b.test({ id }) as { ok: boolean; error?: string };
      alert(res.ok ? "连接测试通过" : `测试失败: ${res.error ?? "未知"}`);
    } catch (e) { alert((e as { message?: string })?.message ?? String(e)); }
  };
  const handleRemove = async (id: string) => {
    if (!confirm("确定删除该 QQ Bot 配置？")) return;
    const b = getChannelsBridge(); if (!b) return;
    try { await b.remove({ id }); await refresh(); } catch (e) { alert((e as { message?: string })?.message ?? String(e)); }
  };
  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    const b = getChannelsBridge(); if (!b) return;
    try { await b.setEnabled({ id, enabled }); await refresh(); } catch (e) { alert((e as { message?: string })?.message ?? String(e)); }
  };

  if (loading) return <p className="text-xs text-sandrift">加载中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-charcoal">消息渠道</h3>
        <button type="button" onClick={() => setAddOpen(true)} data-testid="channel-add-qq" className="h-8 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />添加 QQ Bot
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="p-6 flex flex-col items-center text-center gap-3 bg-surface border border-line rounded-xl">
          <div className="w-10 h-10 rounded-xl bg-pastel-mint/60 border border-line flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-charcoal" />
          </div>
          <div>
            <p className="text-sm font-bold text-charcoal">还没有消息渠道</p>
            <p className="text-xs text-sandrift mt-1">添加 QQ Bot 后，私聊/群 @ 消息将进入统一收件箱（receive-only，不自动触发 Kiro）</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map(({ config, health }) => (
            <div key={config.id} data-testid={`channel-card-${config.id}`} className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-alabaster border border-line flex items-center justify-center shrink-0 mt-0.5">
                    <MessageSquare className="w-4 h-4 text-charcoal" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-charcoal truncate">{config.displayName}</h4>
                    <p className="text-xs text-sandrift truncate">App ID: {config.appId} · {config.receiveDirectMessages ? "接收私聊" : "不接收私聊"} · {config.receiveGroupMessages ? "接收群聊" : "不接收群聊"} {config.requireMentionInGroup ? "· 群聊需 @" : ""}</p>
                    <p className="text-[11px] text-sandrift mt-1">允许用户: {config.allowedUsers.length ? config.allowedUsers.join(", ") : "不限制"} · 允许群: {config.allowedGroups.length ? config.allowedGroups.join(", ") : "不限制"}</p>
                    {health.lastError && <p className="text-[11px] text-danger mt-1">错误: {health.lastError.code} {health.lastError.message}</p>}
                  </div>
                </div>
                <span className={cn("shrink-0 px-2 py-1 rounded-full text-[11px] font-bold border", stateColor(health.state))}>{stateLabel(health.state)}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={() => setEditTarget({ config, health })} data-testid={`channel-edit-${config.id}`} className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"><Settings2 className="w-3 h-3" />配置</button>
                <button type="button" onClick={() => handleTest(config.id)} data-testid={`channel-test-${config.id}`} className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"><TestTube2 className="w-3 h-3" />测试连接</button>
                {health.state === "connected" ? (
                  <button type="button" onClick={() => handleDisconnect(config.id)} data-testid={`channel-disconnect-${config.id}`} className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"><Power className="w-3 h-3" />断开</button>
                ) : (
                  <button type="button" onClick={() => handleConnect(config.id)} data-testid={`channel-connect-${config.id}`} className="h-7 px-3 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black flex items-center gap-1"><Plug2 className="w-3 h-3" />连接</button>
                )}
                <button type="button" onClick={() => handleRemove(config.id)} data-testid={`channel-remove-${config.id}`} className="h-7 px-3 bg-white border border-line text-danger text-xs font-bold rounded-lg hover:bg-alabaster"><Trash2 className="w-3 h-3" /></button>
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={config.enabled} onChange={(e) => handleToggleEnabled(config.id, e.target.checked)} /> 启用
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddQQDialog open={addOpen} onOpenChange={setAddOpen} onAdded={refresh} />
      {editTarget && <EditQQDialog target={editTarget} onOpenChange={(o) => !o && setEditTarget(null)} onSaved={refresh} />}
    </div>
  );
}

function AddQQDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
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

  useEffect(() => { if (!open) { setDisplayName(""); setAppId(""); setAppSecret(""); setError(null); } }, [open]);

  const handleSave = async () => {
    setError(null);
    if (!displayName.trim() || !appId.trim() || !appSecret.trim()) { setError("名称 / App ID / App Secret 必填"); return; }
    if (!/^\d+$/.test(appId.trim())) { setError("App ID 必须为数字"); return; }
    const credBridge = getCredentialsBridge();
    const chBridge = getChannelsBridge();
    if (!credBridge || !chBridge) { setError("桌面环境不可用"); return; }
    setSaving(true);
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
      // clear secret from state
      setAppSecret("");
      onAdded();
      onOpenChange(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
      // if credential created but channel failed, try delete credential to avoid orphan
      if (credentialRef) {
        try { await (credBridge as unknown as { delete: (i: unknown) => Promise<unknown> }).delete({ credentialRef }); } catch {}
      }
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayId="channel-add-qq" aria-label="添加 QQ Bot" className="w-[min(520px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center"><MessageSquare className="w-4 h-4 text-charcoal" /></div>
        <div><h4 className="text-sm font-bold text-charcoal">添加 QQ Bot</h4><p className="text-[11px] text-sandrift">WebSocket 长连接 · 需 App ID / App Secret</p></div>
      </div>
      <div className="space-y-3">
        <div><label className="text-xs font-bold text-charcoal">名称 *</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的 QQ 机器人" data-testid="qq-add-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        <div><label className="text-xs font-bold text-charcoal">App ID *</label><input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456789" data-testid="qq-add-appid" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono" /></div>
        <div><label className="text-xs font-bold text-charcoal">App Secret *</label><input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="••••••••" data-testid="qq-add-secret" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono" /><p className="text-[11px] text-sandrift mt-1">仅存于 SecretVault，关闭后不保留明文</p></div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveDirectMessages} onChange={(e) => setReceiveDirectMessages(e.target.checked)} /> 接收私聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveGroupMessages} onChange={(e) => setReceiveGroupMessages(e.target.checked)} /> 接收群聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={requireMentionInGroup} onChange={(e) => setRequireMentionInGroup(e.target.checked)} /> 群聊需 @</label>
        </div>
        <div><label className="text-xs font-bold text-charcoal">允许用户 QQ / OpenID (逗号分隔，空=不限制)</label><input value={allowedUsers} onChange={(e) => setAllowedUsers(e.target.value)} placeholder="user1, user2" data-testid="qq-add-allowed-users" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        <div><label className="text-xs font-bold text-charcoal">允许群 ID (逗号分隔)</label><input value={allowedGroups} onChange={(e) => setAllowedGroups(e.target.value)} placeholder="group1, group2" data-testid="qq-add-allowed-groups" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} data-testid="qq-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </Dialog>
  );
}

function EditQQDialog({ target, onOpenChange, onSaved }: { target: ChannelStatus; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
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
        <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center"><MessageSquare className="w-4 h-4 text-charcoal" /></div>
        <div><h4 className="text-sm font-bold text-charcoal">编辑 QQ Bot</h4><p className="text-[11px] text-sandrift">App ID: {target.config.appId}</p></div>
      </div>
      <div className="space-y-3">
        <div><label className="text-xs font-bold text-charcoal">名称</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="qq-edit-name" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        <div><label className="text-xs font-bold text-charcoal">App Secret</label><input type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder="已安全保存（留空则不修改）" data-testid="qq-edit-secret" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm font-mono" /><p className="text-[11px] text-sandrift mt-1">输入新 Secret 将替换旧凭据</p></div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveDirectMessages} onChange={(e) => setReceiveDirectMessages(e.target.checked)} /> 接收私聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiveGroupMessages} onChange={(e) => setReceiveGroupMessages(e.target.checked)} /> 接收群聊</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={requireMentionInGroup} onChange={(e) => setRequireMentionInGroup(e.target.checked)} /> 群聊需 @</label>
        </div>
        <div><label className="text-xs font-bold text-charcoal">允许用户</label><input value={allowedUsers} onChange={(e) => setAllowedUsers(e.target.value)} data-testid="qq-edit-allowed-users" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        <div><label className="text-xs font-bold text-charcoal">允许群</label><input value={allowedGroups} onChange={(e) => setAllowedGroups(e.target.value)} data-testid="qq-edit-allowed-groups" className="mt-1 w-full h-9 px-3 bg-white border border-line rounded-lg text-sm" /></div>
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} data-testid="qq-edit-save" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </Dialog>
  );
}
