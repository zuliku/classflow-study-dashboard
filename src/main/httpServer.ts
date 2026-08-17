import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { app } from "electron";
import { handleChat } from "@/app/api/ai/chat/route";
import { handleCompact } from "@/app/api/ai/compact/route";
import { handleTest } from "@/app/api/ai/test/route";
import { handleModels } from "@/app/api/ai/models/route";
import { handleVisionExtract } from "@/app/api/ai/vision/extract/route";
import { handleWebSearchTest } from "@/app/api/ai/web-search/test/route";
import { handleWebSearchStatus } from "@/app/api/ai/web-search/status/route";

export interface ApiServer {
  port: number;
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

export function startApiServer(): Promise<ApiServer> {
  const CORS_HEADERS: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // 渲染进程 origin 为 file://（生产）/ http://localhost（dev）：一律跨源，
    // 本地回环服务只服务本机窗口，CORS 全放行（无第三方网站可访问 127.0.0.1 随机端口响应）
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", CORS_HEADERS["access-control-allow-methods"]);
    res.setHeader("access-control-allow-headers", CORS_HEADERS["access-control-allow-headers"]);
    res.setHeader("access-control-max-age", CORS_HEADERS["access-control-max-age"]);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const route = ROUTES.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND", message: "未知接口。" }));
      return;
    }
    const webReq = toWebRequest(req, res, url.toString());
    route
      .handler(webReq)
      .then((webRes) => sendWebResponse(res, webRes, CORS_HEADERS))
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
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
