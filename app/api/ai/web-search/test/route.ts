import { NextRequest } from "next/server";
import { resolveWebSearchCredential } from "@/lib/ai/web/credentials";
import { getKiroWebSearchProvider } from "@/lib/ai/web/provider";
import { WEB_SEARCH_TIMEOUT_MS } from "@/lib/ai/web/types";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Kiro Search 测试连接（Task 14D）：
 * - 只发送最小搜索请求验证凭据（不发送 Chat History / ClassFlow 数据 / 用户资料）
 * - Server mode：测试部署侧 Server Key；BYOK：测试用户提供的 Key
 * - 返回 { ok:true } 或 { ok:false, code, message }；绝不返回 usage detail / API Key / Tavily raw errors
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, code: "WEB_SEARCH_FAILED", message: "请求格式无效。" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const mode = b.credentialMode === "byok" ? "byok" : "server";

  const resolved = resolveWebSearchCredential({
    mode,
    userApiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
  });
  if (!resolved.ok) {
    return Response.json({ ok: false, code: resolved.code, message: resolved.message }, { status: 200 });
  }

  const provider = getKiroWebSearchProvider("tavily");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  try {
    const outcome = await provider.search(
      { query: "ClassFlow" },
      { apiKey: resolved.apiKey, signal: controller.signal }
    );
    if (!outcome.ok) {
      return Response.json({ ok: false, code: outcome.code, message: outcome.message }, { status: 200 });
    }
    return Response.json({ ok: true });
  } finally {
    clearTimeout(timer);
  }
}
