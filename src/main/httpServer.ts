import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { handleChat } from "@/app/api/ai/chat/route";
import { handleCompact } from "@/app/api/ai/compact/route";
import { handleTest } from "@/app/api/ai/test/route";
import { handleModels } from "@/app/api/ai/models/route";
import { handleVisionExtract } from "@/app/api/ai/vision/extract/route";
import { handleWebSearchTest } from "@/app/api/ai/web-search/test/route";
import { handleWebSearchStatus } from "@/app/api/ai/web-search/status/route";
import { handleDistill } from "@/app/api/ai/skills/distill/route";
import { handleReplyDraft } from "@/app/api/ai/reply-draft/route";

export interface ApiServer {
  port: number;
  capability: string;
  close: () => Promise<void>;
}

type Handler = (req: Request) => Promise<Response>;

const ROUTES: { method: string; path: string; handler: Handler }[] = [
  { method: "POST", path: "/api/ai/chat", handler: handleChat },
  { method: "POST", path: "/api/ai/compact", handler: handleCompact },
  { method: "POST", path: "/api/ai/test", handler: handleTest },
  { method: "GET", path: "/api/ai/models", handler: handleModels },
  { method: "POST", path: "/api/ai/vision/extract", handler: handleVisionExtract },
  { method: "POST", path: "/api/ai/web-search/test", handler: handleWebSearchTest },
  { method: "GET", path: "/api/ai/web-search/status", handler: handleWebSearchStatus },
  { method: "POST", path: "/api/ai/skills/distill", handler: handleDistill },
  { method: "POST", path: "/api/ai/reply-draft", handler: handleReplyDraft },
];

/**
 * 桌面版 PDF 字体资源路径：
 * - 打包后 pdfjs-dist 位于 app.asar.unpacked（asarUnpack 配置），从 resources/app.asar.unpacked 解析
 * - 开发模式从项目根 node_modules 解析
 */
export function resolvePdfFontBaseUrl(): string {
  const packed = app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", "node_modules", "pdfjs-dist", "standard_fonts")
    : join(app.getAppPath(), "node_modules", "pdfjs-dist", "standard_fonts");
  return pathToFileURL(packed + (packed.endsWith("\\") || packed.endsWith("/") ? "" : "\\")).toString();
}

/** 主进程启动前注入：pdfVisionRasterizer 的 Node 分支从该 env 读取 standardFontDataUrl */
export function installPdfFontEnv(): void {
  process.env.CLASSFLOW_PDF_FONTS_URL = resolvePdfFontBaseUrl();
}

/**
 * Node IncomingMessage → 标准 Web Request（供 handler 复用原 route.ts 逻辑）。
 * 客户端断开检测：IncomingMessage 的 "close" 在请求体消费完就触发（POST 必中），
 * 不能作为断开依据；正确语义是 ServerResponse "close" 且响应未完成 → 客户端断开，
 * 此时中止 AbortController 让 AI 流式请求及时取消。
 */
function toWebRequest(req: IncomingMessage, res: ServerResponse, url: string): Request {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", onClose);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const body: ReadableStream | undefined =
    method === "GET" || method === "HEAD" ? undefined : (req as unknown as ReadableStream);
  return new Request(url, {
    method,
    headers,
    body: body as BodyInit | null | undefined,
    signal: controller.signal,
    duplex: "half",
  } as RequestInit);
}

async function sendWebResponse(
  nodeRes: ServerResponse,
  webRes: Response,
  extraHeaders?: Record<string, string>
): Promise<void> {
  nodeRes.writeHead(webRes.status, webRes.statusText, {
    ...Object.fromEntries(webRes.headers.entries()),
    ...extraHeaders,
  });
  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(Buffer.from(value));
      }
    } catch {
      /* 流中断（客户端断开）直接结束响应 */
    }
  }
  nodeRes.end();
}

/** 仅允许的 Origin：app://bundle（生产）与当前 ELECTRON_RENDERER_URL（开发） */
function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === "app://bundle") return true;
  if (origin === "app://bundle/") return true;
  if (origin.startsWith("app://bundle")) return false; // 仅允许精确 app://bundle
  // ELECTRON_RENDERER_URL 为 dev 下 http://localhost:5173 等
  const devOrigin = process.env.ELECTRON_RENDERER_URL;
  if (devOrigin) {
    if (origin === devOrigin) return true;
    // 允许 dev origin 仅精确匹配，防止任意 localhost 端口被信任
    if (origin === devOrigin.replace(/\/$/, "")) return true;
  }
  return false;
}

export function startApiServer(opts?: { capability?: string }): Promise<ApiServer> {
  const expectedCapability = opts?.capability ?? randomUUID();

  // 不再使用 Access-Control-Allow-Origin: *，改为按 Origin 白名单回显
  const server = createServer((req, res) => {
    const origin = req.headers.origin as string | undefined;

    // Origin 校验：仅允许 app://bundle 与当前 dev origin
    if (origin !== undefined && !isTrustedOrigin(origin)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "FORBIDDEN", message: "Invalid origin" }));
      return;
    }

    // capability 校验：缺失或错误 → 401（不写日志避免泄漏）
    const incomingCap = req.headers["x-classflow-capability"] as string | undefined;
    if (req.method !== "OPTIONS") {
      if (!incomingCap || incomingCap !== expectedCapability) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "UNAUTHORIZED", message: "Missing capability" }));
        return;
      }
    } else {
      // 预检同样校验 capability（若提供）
      if (incomingCap && incomingCap !== expectedCapability) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "UNAUTHORIZED", message: "Invalid capability" }));
        return;
      }
    }

    const requestOrigin = origin && isTrustedOrigin(origin) ? origin : "app://bundle";
    const corsHeaders: Record<string, string> = {
      "access-control-allow-origin": requestOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-classflow-capability",
      "access-control-max-age": "600",
      "vary": "Origin",
    };

    for (const [k, v] of Object.entries(corsHeaders)) {
      res.setHeader(k, v);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = ROUTES.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "未知接口。" }));
      return;
    }
    const webReq = toWebRequest(req, res, url.toString());
    route
      .handler(webReq)
      .then((webRes) => sendWebResponse(res, webRes, corsHeaders))
      .catch((err) => {
        console.error(`[classflow-api] ${route.method} ${route.path} 失败:`, err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "UNKNOWN", message: "服务内部错误。" }));
        } else {
          res.end();
        }
      });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      console.log(`[classflow-api] local API server listening on http://127.0.0.1:${port}`);
      resolve({ port, capability: expectedCapability, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
