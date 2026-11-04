/**
 * Keyless live smoke（默认跳过；CI 不依赖真实网络）。
 *
 * 运行：
 *   $env:KIRO_WEB_SEARCH_LIVE="1"; node node_modules/vitest/vitest.mjs run tests/kiroWebSearchLive.test.ts
 */
import { describe, expect, it } from "vitest";
import { createKeylessSearchRouter } from "@/lib/ai/web/keyless/router";
import { createKeylessEvidenceRouter } from "@/lib/ai/web/keyless/router";

const LIVE = process.env.KIRO_WEB_SEARCH_LIVE === "1";

describe.skipIf(!LIVE)("Kiro keyless web search live", () => {
  it(
    "Exa/Parallel keyless router 返回真实 http(s) 来源",
    async () => {
      const router = createKeylessSearchRouter();
      const outcome = await router.provider.search(
        { query: "latest AI news", timeRange: "week" },
        { apiKey: "", signal: AbortSignal.timeout(12_000) }
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.results.length).toBeGreaterThan(0);
      for (const result of outcome.results) {
        expect(result.url).toMatch(/^https?:\/\//);
        expect(result.sourceId).toBe("");
        expect(result.title.length).toBeGreaterThan(0);
      }
      router.reset();
    },
    20_000
  );

  it(
    "中文 query 走 keyless CJK 顺序并返回真实来源",
    async () => {
      const router = createKeylessSearchRouter();
      const outcome = await router.provider.search(
        { query: "2026 考研 报名时间 官方" },
        { apiKey: "", signal: AbortSignal.timeout(12_000) }
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.results.length).toBeGreaterThan(0);
      for (const result of outcome.results) expect(result.url).toMatch(/^https?:\/\//);
      router.reset();
    },
    20_000
  );

  it(
    "Exa/Parallel keyless evidence 返回 chunks，且不产生页码",
    async () => {
      const router = createKeylessEvidenceRouter();
      const outcome = await router.provider.extract(
        {
          sources: [{ sourceId: "web-1", url: "https://example.com/" }],
          query: "example domain",
        },
        { apiKey: "", signal: AbortSignal.timeout(15_000) }
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.sources.length).toBeGreaterThan(0);
      expect(outcome.sources[0].availablePages).toBeUndefined();
      expect(outcome.sources[0].chunks.length).toBeGreaterThan(0);
      router.reset();
    },
    25_000
  );
});
