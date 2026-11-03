#!/usr/bin/env node
/**
 * OpenCode Go 快速 smoke（开发自检，不进入 CI）。
 *
 * 用法：
 *   OPENCODE_GO_TEST_API_KEY=oc_sk_... npm run smoke:opencode
 *   OPENCODE_GO_TEST_API_KEY=... OPENCODE_GO_TEST_MODEL=deepseek-v4.1-flash npm run smoke:opencode
 *
 * 覆盖官方接入的关键路径（默认单模型、单轮，成本极低）：
 * 1. 模型目录 /v1/models 可访问且包含目标模型
 * 2. OpenAI Chat Completions 非流式
 * 3. OpenAI Chat Completions 流式（SSE）
 * 4. tool calling（一次工具调用即可）
 *
 * 注意：绝不打印 API Key；失败时只输出状态码与截断后的响应体。
 */

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? process.env.OPENCODE_API_KEY ?? "";
const MODEL = process.env.OPENCODE_GO_TEST_MODEL ?? "deepseek-v4.1-flash";

/** 官方文档（https://opencode.ai/v2/docs/console/go）：Go 根地址 + 分 API 路径 */
const BASE = "https://opencode.ai/inference/go";
const MODELS_URL = `${BASE}/v1/models`;
const CHAT_URL = `${BASE}/openai/v1/chat/completions`;
const SESSION = `classflow-smoke-${Date.now().toString(36)}`;

if (!KEY) {
  console.error("缺少 OPENCODE_GO_TEST_API_KEY（或 OPENCODE_API_KEY）。");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "x-opencode-session": SESSION,
  "user-agent": "ClassFlow-Smoke/1.0",
};

function fail(label, detail) {
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = 1;
}

function pass(label, extra = "") {
  console.log(`PASS  ${label}${extra ? `  ${extra}` : ""}`);
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status} ${text.slice(0, 300)}`;
}

async function checkModels() {
  const res = await fetch(MODELS_URL, {
    headers: { accept: "application/json", "user-agent": headers["user-agent"] },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return fail("models", await readError(res));
  const data = await res.json();
  const ids = (data.data ?? data.models ?? []).map((m) => m.id);
  if (!ids.includes(MODEL)) return fail("models", `目录中不存在 ${MODEL}`);
  pass("models", `count=${ids.length}`);
}

async function checkChat() {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: "只回复两个字母：OK" }],
    max_tokens: 16,
    stream: false,
  };
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return fail("chat", await readError(res));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) return fail("chat", "空响应");
  pass("chat", `${text.trim().slice(0, 20)} · ${data.model ?? MODEL}`);
}

async function checkStream() {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: "只回复两个字母：OK" }],
    max_tokens: 32,
    stream: true,
    stream_options: { include_usage: true },
  };
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return fail("stream", await readError(res));
  const raw = await res.text();
  let text = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      text += chunk.choices?.[0]?.delta?.content ?? "";
    } catch {
      // SSE 注释 / 心跳行忽略
    }
  }
  if (!text.trim()) return fail("stream", "没有解析到 text delta");
  pass("stream", text.trim().slice(0, 20));
}

async function checkTools() {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: "调用 get_time 工具，不要直接回答。" }],
    max_tokens: 128,
    tools: [
      {
        type: "function",
        function: {
          name: "get_time",
          description: "获取当前时间",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ],
    tool_choice: "auto",
  };
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return fail("tools", await readError(res));
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return fail("tools", "未返回 tool_calls");
  pass("tools", call.function?.name ?? "unknown");
}

async function main() {
  console.log(`OpenCode Go smoke · model=${MODEL} · session=${SESSION}`);
  await checkModels();
  await checkChat();
  await checkStream();
  await checkTools();
  if (process.exitCode) {
    console.error("smoke failed");
    return;
  }
  console.log("smoke passed");
}

main().catch((err) => {
  console.error("FAIL  unexpected —", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
