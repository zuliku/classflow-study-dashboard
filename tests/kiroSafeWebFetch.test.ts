import { describe, it, expect } from "vitest";
import {
  normalizeWebFetchUrl,
  isBlockedHostname,
  isBlockedIpAddress,
} from "@/lib/ai/web/native/networkSafety";
import {
  safeWebFetch,
  MAX_WEB_FETCH_REDIRECTS,
  WEB_FETCH_TIMEOUT_MS,
  MAX_WEB_FETCH_BYTES,
} from "@/lib/ai/web/native/safeFetch";
import type {
  KiroHttpTransport,
  KiroHttpTransportRequest,
  KiroHttpTransportResponse,
} from "@/lib/ai/web/native/safeFetch";

const encode = (s: string) => new TextEncoder().encode(s);

function bodyOf(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

function htmlResponse(over: Partial<KiroHttpTransportResponse> = {}): KiroHttpTransportResponse {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: bodyOf([encode("<html>ok</html>")]),
    ...over,
  };
}

/** 生产 DNS 语义的最小 fake：直接返回给定地址列表 */
const dns =
  (...addresses: string[]) =>
  async () =>
    addresses;

function recordingTransport(
  handler: (opts: KiroHttpTransportRequest) => Promise<KiroHttpTransportResponse>
): { transport: KiroHttpTransport; calls: KiroHttpTransportRequest[] } {
  const calls: KiroHttpTransportRequest[] = [];
  return {
    transport: {
      async request(opts) {
        calls.push(opts);
        return handler(opts);
      },
    },
    calls,
  };
}

describe("normalizeWebFetchUrl — protocol / credentials / port", () => {
  it("Case 1a. 允许 http / https", () => {
    expect(normalizeWebFetchUrl("https://example.com/a")?.protocol).toBe("https:");
    expect(normalizeWebFetchUrl("http://example.com/a")?.protocol).toBe("http:");
  });
  it("Case 1b. 拒绝 file / ftp / data / javascript", () => {
    expect(normalizeWebFetchUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeWebFetchUrl("ftp://example.com")).toBeNull();
    expect(normalizeWebFetchUrl("data:text/plain,x")).toBeNull();
    expect(normalizeWebFetchUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebFetchUrl("not a url")).toBeNull();
  });
  it("Case 1c. 拒绝 credentials 与非默认端口", () => {
    expect(normalizeWebFetchUrl("https://user:pass@example.com/")).toBeNull();
    expect(normalizeWebFetchUrl("https://user@example.com/")).toBeNull();
    expect(normalizeWebFetchUrl("http://example.com:3000/")).toBeNull();
    expect(normalizeWebFetchUrl("https://example.com:8080/")).toBeNull();
    expect(normalizeWebFetchUrl("https://example.com:443/")).not.toBeNull(); // 默认端口归并为空
    expect(normalizeWebFetchUrl("http://example.com:80/")).not.toBeNull();
  });
});

describe("isBlockedHostname", () => {
  it("Case 2. 拒绝 localhost / *.localhost / *.local / *.internal；放行普通域名", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("api.localhost")).toBe(true);
    expect(isBlockedHostname("foo.local")).toBe(true);
    expect(isBlockedHostname("foo.internal")).toBe(true);
    expect(isBlockedHostname("EXAMPLE.COM.")).toBe(false); // lowercase + trim trailing dot
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("www.example.com")).toBe(false);
  });
});

describe("isBlockedIpAddress", () => {
  it("Case 3. IPv4 私网 / 特殊段全部拒绝；公网放行", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "172.16.0.1", "172.31.255.1", "100.64.0.1", "0.0.0.0", "192.0.2.10", "198.18.0.1", "203.0.113.9", "224.0.0.1", "240.0.0.1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
  });
  it("Case 4. IPv6 环回 / 私网 / link-local / multicast / v4-mapped 拒绝；公网放行", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "0:0:0:0:0:0:0:1"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
    expect(isBlockedIpAddress("2606:4700::1111")).toBe(false);
  });
});

describe("safeWebFetch — DNS 与地址固定", () => {
  it("Case 5. mixed DNS（public + private）→ 整体拒绝，transport 不被调用", async () => {
    const { transport, calls } = recordingTransport(async () => htmlResponse());
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34", "127.0.0.1"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_BLOCKED_IP");
    expect(calls).toHaveLength(0);
  });
  it("Case 5b. 全部 public 地址 → 放行，pinned 为第一个地址", async () => {
    const { transport, calls } = recordingTransport(async (opts) => {
      expect(opts.pinnedAddress).toBe("93.184.216.34");
      expect(opts.hostname).toBe("example.com"); // Host/SNI 保持原始 hostname
      return htmlResponse();
    });
    const out = await safeWebFetch(
      { url: "https://example.com/path?q=1" },
      { resolveHost: dns("93.184.216.34", "8.8.8.8"), transport }
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.body).toBe("<html>ok</html>");
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/path?q=1");
  });
  it("DNS 解析失败 → WEB_FETCH_FAILED（不泄漏 ENOTFOUND）", async () => {
    const { transport } = recordingTransport(async () => htmlResponse());
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      {
        resolveHost: async () => {
          throw new Error("ENOTFOUND example.com");
        },
        transport,
      }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_FAILED");
  });
  it("直接 IP URL 走文本分类，不查 DNS", async () => {
    const { transport } = recordingTransport(async () => htmlResponse());
    const out = await safeWebFetch(
      { url: "http://127.0.0.1/" },
      { resolveHost: dns("8.8.8.8"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_BLOCKED_IP");
  });
});

describe("safeWebFetch — redirect", () => {
  it("Case 6. redirect 到私网 IP → WEB_FETCH_REDIRECT_BLOCKED（目标跳转前被拒绝）", async () => {
    const { transport, calls } = recordingTransport(async () =>
      htmlResponse({ status: 302, headers: { location: "http://127.0.0.1/" } })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_REDIRECT_BLOCKED");
    expect(calls).toHaveLength(1); // 第二次请求从未发出
  });
  it("Case 6b. HTTPS → HTTP downgrade 拒绝", async () => {
    const { transport } = recordingTransport(async () =>
      htmlResponse({ status: 302, headers: { location: "http://example.com/plain" } })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_REDIRECT_BLOCKED");
  });
  it("Case 7. 4 次 redirect → WEB_FETCH_TOO_MANY_REDIRECTS", async () => {
    const { transport, calls } = recordingTransport(async (opts) =>
      htmlResponse({
        status: 302,
        headers: { location: `https://example.com/r${calls.length}` },
      })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/start" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_TOO_MANY_REDIRECTS");
    expect(calls).toHaveLength(MAX_WEB_FETCH_REDIRECTS + 1);
  });
  it("相对 Location 解析 + 每跳重新 vet + finalUrl 为最终地址", async () => {
    const { transport, calls } = recordingTransport(async (opts) => {
      if (calls.length === 1) {
        return htmlResponse({ status: 301, headers: { location: "/next" } });
      }
      return htmlResponse();
    });
    const out = await safeWebFetch(
      { url: "https://example.com/a" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.finalUrl).toBe("https://example.com/next");
      expect(out.body).toBe("<html>ok</html>");
    }
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe("/next");
  });
});

describe("safeWebFetch — 大小预算与内容策略", () => {
  it("Case 8. Content-Length > 1.5MB → WEB_FETCH_TOO_LARGE（不读 body）", async () => {
    const { transport } = recordingTransport(async () =>
      htmlResponse({
        headers: { "content-type": "text/html", "content-length": String(MAX_WEB_FETCH_BYTES + 1) },
      })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_TOO_LARGE");
  });
  it("Case 9. 无 Content-Length，流式字节累计超过 limit → WEB_FETCH_TOO_LARGE", async () => {
    const chunk = new Uint8Array(800_000);
    const { transport } = recordingTransport(async () =>
      htmlResponse({
        headers: { "content-type": "text/html" },
        body: bodyOf([chunk, chunk, chunk]), // 2.4MB > 1.5MB
      })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_TOO_LARGE");
  });
  it("Case 10. text/html → success；image/png → WEB_FETCH_UNSUPPORTED_CONTENT", async () => {
    const { transport } = recordingTransport(async () => htmlResponse());
    const ok = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(ok.ok).toBe(true);

    const { transport: t2 } = recordingTransport(async () =>
      htmlResponse({ headers: { "content-type": "image/png" } })
    );
    const bad = await safeWebFetch(
      { url: "https://example.com/img.png" },
      { resolveHost: dns("93.184.216.34"), transport: t2 }
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("WEB_FETCH_UNSUPPORTED_CONTENT");
  });
  it("Content-Encoding 非 identity → WEB_FETCH_UNSUPPORTED_CONTENT", async () => {
    const { transport } = recordingTransport(async () =>
      htmlResponse({ headers: { "content-type": "text/html", "content-encoding": "gzip" } })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_UNSUPPORTED_CONTENT");
  });
});

describe("safeWebFetch — 超时 / 状态码", () => {
  it("Case 11. transport 挂起 → WEB_FETCH_TIMEOUT（内部 timeout 触发 abort）", async () => {
    const transport: KiroHttpTransport = {
      request: (opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted by timeout")),
            { once: true }
          );
        }),
    };
    const out = await safeWebFetch(
      { url: "https://example.com/" },
      { resolveHost: dns("93.184.216.34"), transport, timeoutMs: 50 }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_TIMEOUT");
  });
  it("4xx → WEB_FETCH_HTTP_ERROR（不返回 error 页面正文）", async () => {
    const { transport } = recordingTransport(async () =>
      htmlResponse({ status: 404, headers: { "content-type": "text/html" } })
    );
    const out = await safeWebFetch(
      { url: "https://example.com/missing" },
      { resolveHost: dns("93.184.216.34"), transport }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_HTTP_ERROR");
  });
  it("外部 signal 已 abort → 立即失败", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await safeWebFetch(
      { url: "https://example.com/", signal: controller.signal },
      { resolveHost: dns("93.184.216.34"), transport: { request: async () => htmlResponse() } }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_FETCH_FAILED");
  });
  it("默认常量符合任务约束", () => {
    expect(MAX_WEB_FETCH_REDIRECTS).toBe(3);
    expect(WEB_FETCH_TIMEOUT_MS).toBe(8_000);
    expect(MAX_WEB_FETCH_BYTES).toBe(1_500_000);
  });
});
