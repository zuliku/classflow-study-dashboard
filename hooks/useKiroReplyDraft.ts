"use client";

import { useCallback, useRef, useState } from "react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { apiUrl } from "@/lib/desktop/apiBase";

export type ReplyDraftTone = "natural" | "concise" | "formal" | "friendly";

export function useKiroReplyDraft() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const currentItemIdRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    seqRef.current += 1;
    currentItemIdRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const generateDraft = useCallback(
    async (input: { inboxItemId: string; message: string; senderDisplay?: string; tone?: ReplyDraftTone; source?: string }): Promise<{ draft: string; inboxItemId: string; requestSeq: number } | null> => {
      const enabled = useAISettingsStore.getState().enabled;
      if (!enabled) {
        setError("请先在设置中启用 Kiro");
        return null;
      }
      const provider = useAISettingsStore.getState().provider as "opencode-go" | "deepseek" | "custom-openai";
      const model = useAISettingsStore.getState().model;
      const custom = useAISettingsStore.getState().custom;
      const reasoningEffort = useAISettingsStore.getState().reasoningEffort;
      const apiKey = getSessionApiKey(provider);
      if (!apiKey) {
        setError("请先配置当前 AI 服务的 API Key");
        return null;
      }

      // Cancel previous and start new
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // P0：30s 超时（此前弱网永久 loading；超时按可重试错误上屏，而非静默）
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("timeout", "TimeoutError"));
      }, 30_000);
      const seq = ++seqRef.current;
      currentItemIdRef.current = input.inboxItemId;
      setLoading(true);
      setError(null);

      try {
        const invBridge = (window as unknown as { classflowDesktop?: { invocation?: { beginRemoteInbox: (input: unknown) => Promise<{ invocationId: string }> } } }).classflowDesktop?.invocation;
        if (!invBridge) throw new Error("桌面环境不可用，请重启应用后重试");
        const invSource = (input as { source?: string }).source ?? "qq-bot";
        if (!["qq-bot", "gmail", "qq-mail"].includes(invSource)) throw new Error("该消息暂不支持 AI 草稿");
        const { invocationId } = await invBridge.beginRemoteInbox({ source: invSource, inboxItemId: input.inboxItemId });
        // Check stale after beginRemoteInbox (could have been cancelled/switched)
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId || controller.signal.aborted) {
          return null;
        }

        // Keep AbortSignal in the Renderer world. Passing RequestInit.signal through
        // contextBridge makes the native AbortSignal lose its fetch-compatible identity.
        // The trusted Renderer → exact Local API request still receives its per-launch
        // capability from Main's webRequest injector.
        const res = await fetch(apiUrl("/api/ai/reply-draft"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model,
            apiKey,
            customConfig: custom,
            reasoningEffort,
            invocationId,
            inboxItemId: input.inboxItemId,
            source: invSource,
            message: input.message,
            senderDisplay: input.senderDisplay,
            tone: input.tone ?? "natural",
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // P0：状态码分流中文（此前英文裸错/技术码直达 UI）
          if (res.status === 401 || res.status === 403) throw new Error("API Key 无效，请去设置检查后重试");
          if (res.status === 404) throw new Error("模型不可用，请去设置更换模型后重试");
          if (res.status === 429) throw new Error("请求太频繁，请稍后重试");
          const err = await res.json().catch(() => ({}));
          const msg = (err as { message?: string }).message;
          throw new Error(msg && !/^Draft failed|^[A-Z_]+$/.test(msg) ? msg : `草稿生成失败（${res.status}），可点击重新生成重试`);
        }
        const data = (await res.json()) as { draft: string };
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId || controller.signal.aborted) {
          return null;
        }
        return { draft: data.draft, inboxItemId: input.inboxItemId, requestSeq: seq };
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // 用户取消/切走静默；超时给可重试提示
          if (timedOut && seq === seqRef.current && currentItemIdRef.current === input.inboxItemId) {
            setError("请求超时，可点击重新生成重试");
          }
          return null;
        }
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId) return null;
        setError((e as Error).message ?? "草稿生成失败，可重试");
        return null;
      } finally {
        window.clearTimeout(timeoutId);
        if (seq === seqRef.current) setLoading(false);
      }
    },
    []
  );

  const regenerate = useCallback(
    async (input: { inboxItemId: string; message: string; senderDisplay?: string; tone?: ReplyDraftTone; source?: string }) => {
      return generateDraft(input);
    },
    [generateDraft]
  );

  return { loading, error, generateDraft, regenerate, cancel, setError };
}
