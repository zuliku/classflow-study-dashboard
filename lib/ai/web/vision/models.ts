/**
 * Kiro Web PDF Vision — 模型白名单（Task 19C1）。
 *
 * 唯一能力权威 = 本地 OPENCODE_MODELS（远端 /models catalog 不负责 transport / vision）。
 * 有效 Vision 模型必须同时满足：
 *   provider === "opencode-go"
 *   capabilities.vision === true
 *   transport === "openai-chat"
 *
 * normalize 语义统一：invalid → default（不留 invalid→default OR unavailable 两种语义）。
 */
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";

export const DEFAULT_WEB_PDF_VISION_MODEL = "mimo-v2.5";

export interface KiroWebPdfVisionModelOption {
  id: string;
  name: string;
}

function isVisionCapable(model: { provider: string; capabilities: { vision?: boolean }; transport: string }): boolean {
  return (
    model.provider === "opencode-go" &&
    model.capabilities.vision === true &&
    model.transport === "openai-chat"
  );
}

export function getWebPdfVisionModelOptions(): KiroWebPdfVisionModelOption[] {
  return OPENCODE_MODELS.filter(isVisionCapable).map((m) => ({ id: m.id, name: m.name }));
}

export function isWebPdfVisionModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return OPENCODE_MODELS.some(
    (m) => m.id === value && m.provider === "opencode-go" && m.capabilities.vision === true && m.transport === "openai-chat"
  );
}

/** invalid → DEFAULT_WEB_PDF_VISION_MODEL（统一语义） */
export function normalizeWebPdfVisionModel(value: unknown): string {
  return isWebPdfVisionModel(value) ? value : DEFAULT_WEB_PDF_VISION_MODEL;
}
