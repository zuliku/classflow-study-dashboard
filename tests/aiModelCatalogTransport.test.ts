import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("useAIModelCatalog transport — Task 16D Phase 20", () => {
  it("uses apiUrl for remote catalog (injected via webRequest)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    expect(src).toContain("apiUrl(`/api/ai/models?provider=opencode-go");
    expect(src).toContain('fetch(apiUrl');
    // Must not use requestDesktopApi for catalog (that is DTO, not needed for simple GET)
    expect(src).not.toContain("requestDesktopApi");
  });

  it("handles remote failure gracefully (registry fallback)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    expect(src).toContain("registry fallback");
    expect(src).toContain("catch");
    expect(src).toContain("setModels(fallback)");
  });

  it("2026-09：模型范围偏好（showAllModels）驱动 registry 集合与远端 all=1", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    // 偏好打开 → 全部已验证模型；默认 → 精选列表
    expect(src).toContain("showAllModels ? getModelsForProvider(p) : getSelectorModelsForProvider(p)");
    // 远端请求携带 all=1，且偏好变化触发重取
    expect(src).toContain('showAllModels ? "&all=1" : ""');
    expect(src).toContain("[provider, showAllModels, refreshSeq]");
  });

  it("2026-10：一键刷新（refresh=1 绕过服务端缓存）暴露 refreshing / error", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    // 手动刷新携带 refresh=1，与首次加载区分（不回退 registry fallback）
    expect(src).toContain('manual ? "&refresh=1" : ""');
    expect(src).toContain("refreshing");
    expect(src).toContain("error");
    expect(src).toContain("refreshSeq");
    expect(src).toContain("return { models, loading, refreshing, source, error, refresh }");
    // 刷新失败必须保留当前列表（不 setModels(fallback)）并提示
    expect(src).toContain("已保留本地列表");
  });
});
