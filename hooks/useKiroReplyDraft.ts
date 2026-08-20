"use client";

import { useCallback, useRef, useState } from "react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { requestDesktopApi } from "@/lib/desktop/apiClient";

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
    async (input: { inboxItemId: string; message: string; senderDisplay?: string; tone?: ReplyDraftTone }): Promise<{ draft: string; inboxItemId: string; requestSeq: number } | null> => {
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
      const seq = ++seqRef.current;
      currentItemIdRef.current = input.inboxItemId;
      setLoading(true);
      setError(null);

      try {
        const invBridge = (window as unknown as { classflowDesktop?: { invocation?: { beginRemoteInbox: (input: unknown) => Promise<{ invocationId: string }> } } }).classflowDesktop?.invocation;
        if (!invBridge) throw new Error("Invocation not available");
        const { invocationId } = await invBridge.beginRemoteInbox({ source: "qq-bot", inboxItemId: input.inboxItemId });
        // Check stale after beginRemoteInbox (could have been cancelled/switched)
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId || controller.signal.aborted) {
          return null;
        }

        const res = await requestDesktopApi("/api/ai/reply-draft", {
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
            source: "qq-bot",
            message: input.message,
            senderDisplay: input.senderDisplay,
            tone: input.tone ?? "natural",
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error((err as { message?: string }).message ?? `Draft failed: ${res.status}`);
        }
        const data = (await res.json()) as { draft: string };
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId || controller.signal.aborted) {
          return null;
        }
        return { draft: data.draft, inboxItemId: input.inboxItemId, requestSeq: seq };
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
        if (seq !== seqRef.current || currentItemIdRef.current !== input.inboxItemId) return null;
        setError((e as Error).message ?? String(e));
        return null;
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    []
  );

  const regenerate = useCallback(
    async (input: { inboxItemId: string; message: string; senderDisplay?: string; tone?: ReplyDraftTone }) => {
      return generateDraft(input);
    },
    [generateDraft]
  );

  return { loading, error, generateDraft, regenerate, cancel, setError };
}
