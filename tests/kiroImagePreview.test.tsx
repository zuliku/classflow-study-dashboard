// @vitest-environment jsdom
/**
 * Visual Intake V1.5 / V1.5.1：Live Image Source Registry + KiroImagePreviewDialog。
 * - registry runtime-only：register/resolve/unregister/clear/updateThumbnail
 * - updateThumbnail 只更新已存在 entry（ghost source 竞态硬保证）
 * - 不把 File 写入任何持久层（registry 不是 store；无 persistence API）
 * - Object URL 生命周期：打开 create → 关闭/unmount/source 变化 revoke（不缓存）
 * - Esc / Backdrop / Close Button 关闭；focus 管理；body scroll lock
 * - Gallery（sources + initialIndex）：←/→ / ArrowLeft / ArrowRight / 计数
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  registerLiveImageSource,
  updateLiveImageSourceThumbnail,
  unregisterLiveImageSource,
  clearLiveImageSources,
  resolveLiveImageSource,
  resolveLiveImageSources,
} from "@/lib/ai/attachments/liveImageRegistry";
import * as liveImageRegistryModule from "@/lib/ai/attachments/liveImageRegistry";
import { KiroImagePreviewDialog } from "@/components/kiro/KiroImagePreviewDialog";

function makeFile(name = "screenshot.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

beforeEach(() => {
  clearLiveImageSources();
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => "blob:mock-1"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("Live Image Source Registry（runtime-only）", () => {
  it("register → resolve；id 唯一；thumbnail 保留", () => {
    const file = makeFile();
    registerLiveImageSource({ id: "att-1", file, name: "a.png", thumbnail: "data:image/png;base64,x" });
    const hit = resolveLiveImageSource("att-1");
    expect(hit?.file).toBe(file);
    expect(hit?.name).toBe("a.png");
    expect(hit?.thumbnail).toBe("data:image/png;base64,x");
    expect(resolveLiveImageSource("ghost")).toBeUndefined();
  });

  it("resolveLiveImageSources：保序 + 去重 + 只返回存在项", () => {
    const f1 = makeFile("1.png");
    const f2 = makeFile("2.png");
    registerLiveImageSource({ id: "a", file: f1, name: "1.png" });
    registerLiveImageSource({ id: "b", file: f2, name: "2.png" });
    const out = resolveLiveImageSources(["b", "a", "b", "ghost", "a"]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
    expect(out[0].file).toBe(f2);
  });

  it("unregister / clear → resolve undefined（历史恢复语义 = 空注册表 → 不伪造 Preview）", () => {
    registerLiveImageSource({ id: "a", file: makeFile(), name: "a.png" });
    unregisterLiveImageSource("a");
    expect(resolveLiveImageSource("a")).toBeUndefined();
    registerLiveImageSource({ id: "b", file: makeFile(), name: "b.png" });
    clearLiveImageSources();
    expect(resolveLiveImageSources(["b"])).toHaveLength(0);
  });

  it("非法注册被忽略（无 File / 空 id）", () => {
    registerLiveImageSource({ id: "", file: makeFile(), name: "" });
    registerLiveImageSource({ id: "x", file: null as unknown as File, name: "" });
    expect(resolveLiveImageSources(["", "x"])).toHaveLength(0);
  });

  it("registry 没有任何持久化 API（不进 History / localStorage）", () => {
    const exposed = Object.keys(liveImageRegistryModule).filter((k) =>
      /save|load|persist|storage|indexed|local/i.test(k)
    );
    expect(exposed).toEqual([]);
  });
});

describe("V1.5.1：updateLiveImageSourceThumbnail（ghost source 硬保证）", () => {
  it("entry 存在 → 更新 thumbnail；不存在 → no-op（绝不重建）", () => {
    registerLiveImageSource({ id: "att-1", file: makeFile(), name: "a.png" });
    updateLiveImageSourceThumbnail("att-1", "data:image/png;base64,THUMB");
    expect(resolveLiveImageSource("att-1")?.thumbnail).toBe("data:image/png;base64,THUMB");

    // remove while thumbnail pending → later update = no-op（不得复活）
    unregisterLiveImageSource("att-1");
    updateLiveImageSourceThumbnail("att-1", "data:image/png;base64,LATE");
    expect(resolveLiveImageSource("att-1")).toBeUndefined();

    // conversation clear while thumbnail pending → later update = no-op
    registerLiveImageSource({ id: "att-2", file: makeFile(), name: "b.png" });
    clearLiveImageSources();
    updateLiveImageSourceThumbnail("att-2", "data:image/png;base64,LATE2");
    expect(resolveLiveImageSource("att-2")).toBeUndefined();

    // 从未存在的 id → no-op
    updateLiveImageSourceThumbnail("ghost", "data:image/png;base64,X");
    expect(resolveLiveImageSource("ghost")).toBeUndefined();
  });

  it("thumbnail 清空（失败转 undefined）→ entry 保留但无缩略图", () => {
    registerLiveImageSource({ id: "a", file: makeFile(), name: "a.png" });
    updateLiveImageSourceThumbnail("a", undefined);
    expect(resolveLiveImageSource("a")?.thumbnail).toBeUndefined();
  });
});

describe("KiroImagePreviewDialog", () => {
  function renderDialog(source: { file: File; name: string } | null, opts: { sources?: { file: File; name: string }[]; initialIndex?: number; onClose?: () => void } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = opts.onClose ?? vi.fn();
    act(() => {
      root.render(
        <KiroImagePreviewDialog
          source={source}
          sources={opts.sources}
          initialIndex={opts.initialIndex}
          onClose={onClose}
        />
      );
    });
    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { container, cleanup, onClose };
  }

  it("打开 → createObjectURL；关闭（unmount）→ revokeObjectURL", () => {
    const file = makeFile();
    const { cleanup } = renderDialog({ file, name: "a.png" });
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    const img = document.body.querySelector('[data-testid="kiro-image-preview"] img');
    expect(img).toBeTruthy();
    cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("source 为 null（历史恢复 / 已移除）→ 不渲染，不创建 URL", () => {
    const { cleanup } = renderDialog(null);
    expect(document.body.querySelector('[data-testid="kiro-image-preview"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    cleanup();
  });

  it("长图结构：viewport 承载滚动；img 不做 max-height 压缩（block + h-auto + max-w-full）", () => {
    const file = makeFile();
    const { cleanup } = renderDialog({ file, name: "long.png" });
    expect(document.body.querySelector('[data-testid="kiro-image-preview-viewport"]')).toBeTruthy();
    const img = document.body.querySelector('[data-testid="kiro-image-preview-image"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.className).toContain("h-auto");
    expect(img.className).toContain("max-w-full");
    expect(img.style.maxHeight).toBe("");
    cleanup();
  });

  it("Esc → onClose；无 Esc → 不关闭", () => {
    const file = makeFile();
    const { cleanup, onClose } = renderDialog({ file, name: "x.png" });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("Backdrop 点击 → onClose；Close Button → onClose", () => {
    const file = makeFile();
    const { cleanup, onClose } = renderDialog({ file, name: "x.png" });
    act(() => {
      (document.body.querySelector('[data-testid="kiro-image-preview-backdrop"]') as HTMLDivElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      (document.body.querySelector('[data-testid="kiro-image-preview-close"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("source 变化 → 旧 URL revoke，新 URL create（不缓存无限 object URL）", () => {
    const f1 = makeFile("1.png");
    const f2 = makeFile("2.png");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let source: { file: File; name: string } | null = { file: f1, name: "1.png" };
    const rerender = () => {
      act(() => {
        root.render(<KiroImagePreviewDialog source={source} onClose={() => {}} />);
      });
    };
    rerender();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    source = { file: f2, name: "2.png" };
    rerender();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    act(() => root.unmount());
    container.remove();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("打开后聚焦 Close Button；关闭后 restore previous focus", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const file = makeFile();
    let open = true;
    act(() => {
      root.render(
        <>{open && <KiroImagePreviewDialog source={{ file, name: "x.png" }} onClose={() => {}} />}</>
      );
    });
    expect(document.activeElement).toBe(document.body.querySelector('[data-testid="kiro-image-preview-close"]'));
    open = false;
    act(() => {
      root.render(<></>);
    });
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
    trigger.remove();
    container.remove();
  });

  it("body scroll lock：打开时 overflow=hidden；关闭后恢复", () => {
    const file = makeFile();
    const { cleanup } = renderDialog({ file, name: "x.png" });
    expect(document.body.style.overflow).toBe("hidden");
    cleanup();
    expect(document.body.style.overflow).toBe("");
  });

  it("Gallery：sources>1 显示 ←/→ 与计数；ArrowLeft/ArrowRight 切换；关闭后 index 状态不泄漏", () => {
    const f1 = makeFile("1.png");
    const f2 = makeFile("2.png");
    const f3 = makeFile("3.png");
    const sources = [
      { file: f1, name: "1.png" },
      { file: f2, name: "2.png" },
      { file: f3, name: "3.png" },
    ];
    const { cleanup, onClose } = renderDialog(sources[1], { sources, initialIndex: 1 });
    expect(URL.createObjectURL).toHaveBeenCalledWith(f2);
    expect(document.body.textContent).toContain("2 / 3");
    // ArrowRight → 第 3 张
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(document.body.textContent).toContain("3 / 3");
    expect(URL.createObjectURL).toHaveBeenCalledWith(f3);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    // ArrowLeft ×2 → 回到第 1 张
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(document.body.textContent).toContain("1 / 3");
    // 边界：第 1 张再 ArrowLeft 不动
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(document.body.textContent).toContain("1 / 3");
    // 按钮点击切换
    act(() => {
      (document.body.querySelector('[data-testid="kiro-image-preview-next"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain("2 / 3");
    // Esc 关闭（仍工作）
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("单来源（无 sources）→ 无 Gallery 控件", () => {
    const file = makeFile();
    const { cleanup } = renderDialog({ file, name: "x.png" });
    expect(document.body.querySelector('[data-testid="kiro-image-preview-prev"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="kiro-image-preview-next"]')).toBeNull();
    cleanup();
  });
});
