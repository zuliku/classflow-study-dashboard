import { describe, it, expect, vi } from "vitest";
import { resolveKiroWebEvidence, KiroEvidenceRuntimeDeps } from "@/lib/ai/web/evidenceRuntime";
import { KiroWebEvidenceProvider } from "@/lib/ai/web/provider";
import type { KiroNativeWebReadOutcome, KiroNativeWebReadFailureCode } from "@/lib/ai/web/native/reader";

const REQUEST = {
  sources: [
    { sourceId: "web-3", url: "https://a.dev/3" },
    { sourceId: "web-4", url: "https://b.dev/4" },
  ],
  query: "报名条件",
};

const nativeOk = (sourceId: string, text = "正文内容"): KiroNativeWebReadOutcome => ({
  ok: true,
  sourceId,
  finalUrl: "https://cdn.example.com/redirected",
  chunks: [{ text }],
  truncated: false,
});

const nativeFail = (code: KiroNativeWebReadFailureCode): KiroNativeWebReadOutcome =>
  ({ ok: false, code });

function makeDeps(over: {
  nativeResults?: (request: { sourceId: string }) => KiroNativeWebReadOutcome;
  fallbackResult?: { ok: boolean; sources?: unknown[]; code?: string; message?: string };
  credentialResult?: { ok: boolean; apiKey?: string; code?: string; message?: string };
}) {
  const nativeReader = vi.fn(async (r: { sourceId: string }) => over.nativeResults?.(r) ?? nativeFail("WEB_NATIVE_NO_EVIDENCE"));
  const extract = vi.fn().mockResolvedValue(
    over.fallbackResult ?? { ok: true, sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "fallback" }], truncated: false }] }
  );
  const fallbackProvider: KiroWebEvidenceProvider = {
    id: "tavily",
    extract,
  };
  const resolveFallbackCredential = vi.fn(() =>
    over.credentialResult ??
    ({ ok: true, apiKey: "sk-server", mode: "server" })
  );
  const deps = { nativeReader, fallbackProvider, resolveFallbackCredential } as unknown as KiroEvidenceRuntimeDeps;
  return { nativeReader, fallbackProvider, resolveFallbackCredential, extract, deps };
}

describe("resolveKiroWebEvidence — Native-first", () => {
  it("Test A. Native 全成功 → fallback/credential 0 调用", async () => {
    const { deps, nativeReader, extract, resolveFallbackCredential } = makeDeps({
      nativeResults: (r) => nativeOk(r.sourceId),
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources.map((s) => s.sourceId)).toEqual(["web-3", "web-4"]);
    expect(extract).not.toHaveBeenCalled();
    expect(resolveFallbackCredential).not.toHaveBeenCalled();
    expect(nativeReader).toHaveBeenCalledTimes(2);
  });

  it("Test B. Native NO_EVIDENCE → fallback 只收到该 source", async () => {
    const { deps, extract, resolveFallbackCredential } = makeDeps({
      nativeResults: (r) => nativeFail("WEB_NATIVE_NO_EVIDENCE"),
      fallbackResult: {
        ok: true,
        sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "fallback 正文" }], truncated: false }],
      },
    });
    const out = await resolveKiroWebEvidence({ sources: [REQUEST.sources[0]], query: "x" }, deps);
    expect(out.ok).toBe(true);
    expect(resolveFallbackCredential).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    const req = extract.mock.calls[0][0];
    expect(req.sources).toEqual([{ sourceId: "web-3", url: "https://a.dev/3" }]);
  });

  it("Task 19B. Native PDF page metadata 完整保留：availablePages + chunk pageStart/pageEnd，fallback 0 调用", async () => {
    const { deps, extract, resolveFallbackCredential } = makeDeps({
      nativeResults: (r) =>
        r.sourceId === "web-3"
          ? ({
              ok: true,
              sourceId: "web-3",
              finalUrl: "https://cdn.example.com/zhaosheng.pdf",
              availablePages: [8, 12],
              chunks: [
                { text: "报名条件…", pageStart: 8, pageEnd: 8 },
                { text: "考试科目为871经济学…", pageStart: 12, pageEnd: 12 },
              ],
              truncated: false,
            } as KiroNativeWebReadOutcome)
          : ({
              ok: true,
              sourceId: "web-4",
              finalUrl: "https://cdn.example.com/other.pdf",
              availablePages: [1],
              chunks: [{ text: "web-4 PDF 内容", pageStart: 1, pageEnd: 1 }],
              truncated: false,
            } as KiroNativeWebReadOutcome),
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources[0].availablePages).toEqual([8, 12]);
    expect(out.sources[0].chunks[1]).toEqual({ text: "考试科目为871经济学…", pageStart: 12, pageEnd: 12 });
    expect(out.sources[0].url).toBe("https://a.dev/3"); // finalUrl 不覆盖
    expect(out.sources[1].availablePages).toEqual([1]);
    expect(extract).not.toHaveBeenCalled();
    expect(resolveFallbackCredential).not.toHaveBeenCalled();
  });

  it("Task 19C2. Vision success（native 带页码）→ fallback 0 calls", async () => {
    const { deps, extract, resolveFallbackCredential } = makeDeps({
      nativeResults: (r) =>
        ({
          ok: true,
          sourceId: r.sourceId,
          finalUrl: "https://cdn.example.com/scanned.pdf",
          availablePages: [3],
          chunks: [{ text: "扫描页转录文字", pageStart: 3, pageEnd: 3 }],
          truncated: false,
        } as KiroNativeWebReadOutcome),
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources[0].availablePages).toEqual([3]);
    expect(out.sources[0].chunks[0]).toEqual({ text: "扫描页转录文字", pageStart: 3, pageEnd: 3 });
    expect(extract).not.toHaveBeenCalled();
    expect(resolveFallbackCredential).not.toHaveBeenCalled();
  });

  it("Task 19C2. Vision fail（PDF_SCANNED）→ Tavily fallback success：chunks 无 page metadata、availablePages undefined", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: (r) => nativeFail("WEB_NATIVE_PDF_SCANNED"),
      fallbackResult: {
        ok: true,
        sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "Tavily 提取内容" }], truncated: false }],
      },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(extract).toHaveBeenCalledTimes(1);
    expect(out.sources[0].availablePages).toBeUndefined();
    expect(out.sources[0].chunks[0].pageStart).toBeUndefined();
    expect(out.sources[0].chunks[0].pageEnd).toBeUndefined();
  });

  it("Task 19C2. Native 部分成功 + 另一 source Vision/Tavily 全失败 → 保留成功 evidence", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: (r) =>
        r.sourceId === "web-3" ? nativeOk("web-3", "web-3 native 正文") : nativeFail("WEB_NATIVE_PDF_SCANNED"),
      fallbackResult: { ok: false, code: "WEB_READ_FAILED", message: "extract 失败" },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources.map((s) => s.sourceId)).toEqual(["web-3"]);
    expect(out.sources[0].chunks[0].text).toBe("web-3 native 正文");
  });

  it("Test C. mixed：web-3 Native success + web-4 Native fail → 合并顺序稳定", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: (r) => (r.sourceId === "web-3" ? nativeOk("web-3", "web-3 native 正文") : nativeFail("WEB_NATIVE_PARSE_FAILED")),
      fallbackResult: {
        ok: true,
        sources: [{ sourceId: "web-4", title: "", url: "https://b.dev/4", domain: "", chunks: [{ text: "web-4 fallback" }], truncated: false }],
      },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources.map((s) => s.sourceId)).toEqual(["web-3", "web-4"]);
    expect(out.sources[0].chunks[0].text).toBe("web-3 native 正文"); // Native 优先，不被 fallback 覆盖
    expect(extract.mock.calls[0][0].sources.map((s: { sourceId: string }) => s.sourceId)).toEqual(["web-4"]);
  });

  it("Test D. Policy Blocked → fallback 绝不收到该 URL", async () => {
    const { deps, extract, resolveFallbackCredential } = makeDeps({
      nativeResults: (r) => nativeFail("WEB_NATIVE_POLICY_BLOCKED"),
    });
    const out = await resolveKiroWebEvidence({ sources: [REQUEST.sources[0]] }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources).toEqual([]); // 无 fallback-eligible source → 不执行 fallback
    expect(resolveFallbackCredential).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("Test E. partial + credential fail → 保留 Native evidence", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: (r) => (r.sourceId === "web-3" ? nativeOk("web-3") : nativeFail("WEB_NATIVE_FETCH_FAILED")),
      credentialResult: { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: "bad key" },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources.map((s) => s.sourceId)).toEqual(["web-3"]);
    expect(extract).not.toHaveBeenCalled();
  });

  it("Test F. 全 Native fail + credential fail → 传播 auth 错误", async () => {
    const { deps } = makeDeps({
      nativeResults: (r) => nativeFail("WEB_NATIVE_NO_EVIDENCE"),
      credentialResult: { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: "bad key" },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("WEB_SEARCH_AUTH_FAILED");
  });

  it("Test G. finalUrl 不覆盖 request URL", async () => {
    const { deps } = makeDeps({ nativeResults: (r) => nativeOk(r.sourceId) });
    const out = await resolveKiroWebEvidence({ sources: [REQUEST.sources[0]] }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources[0].url).toBe("https://a.dev/3");
    expect(out.sources[0].url).not.toBe("https://cdn.example.com/redirected");
  });

  it("Test H. nativeReader throw → 不 throw，fallback 正常接管", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: () => {
        throw new Error("boom");
      },
      fallbackResult: {
        ok: true,
        sources: [{ sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "fallback 接管" }], truncated: false }],
      },
    });
    const out = await resolveKiroWebEvidence({ sources: [REQUEST.sources[0]] }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sources[0].chunks[0].text).toBe("fallback 接管");
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("fallback 批量：多个 eligible source 一次 extract", async () => {
    const { deps, extract } = makeDeps({
      nativeResults: (r) => nativeFail(r.sourceId === "web-3" ? "WEB_NATIVE_FETCH_FAILED" : "WEB_NATIVE_NO_EVIDENCE"),
      fallbackResult: {
        ok: true,
        sources: [
          { sourceId: "web-3", title: "", url: "https://a.dev/3", domain: "", chunks: [{ text: "a" }], truncated: false },
          { sourceId: "web-4", title: "", url: "https://b.dev/4", domain: "", chunks: [{ text: "b" }], truncated: false },
        ],
      },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
    const req = extract.mock.calls[0][0];
    expect(req.sources.map((s: { sourceId: string }) => s.sourceId)).toEqual(["web-3", "web-4"]);
  });

  it("Native 全失败 + fallback 真实失败 → 传播 fallback safe error", async () => {
    const { deps } = makeDeps({
      nativeResults: (r) => nativeFail("WEB_NATIVE_PARSE_FAILED"),
      fallbackResult: { ok: false, code: "WEB_READ_FAILED", message: "extract 失败" },
    });
    const out = await resolveKiroWebEvidence(REQUEST, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("WEB_READ_FAILED");
  });
});
