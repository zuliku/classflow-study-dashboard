// @vitest-environment jsdom
/**
 * Visual Intake V1.5：Live Image Source Registry + KiroImagePreviewDialog。
 * - registry runtime-only：register/resolve/unregister/clear + sourceAttachmentIds 保序去重
 * - 不把 File 写入任何持久层（registry 不是 store；无 persistence API）
 * - Object URL 生命周期：打开 create → 关闭/unmount revoke（不缓存）
 * - Esc / Backdrop / Close Button 关闭
 * - 历史恢复（registry 空）→ resolve undefined → 不渲染 Dialog
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  registerLiveImageSource,
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
    // 注册表只暴露 register/resolve/unregister/clear；不存在 save/load/persist 入口
    const exposed = Object.keys(liveImageRegistryModule).filter((k) =>
      /save|load|persist|storage|indexed|local/i.test(k)
    );
    expect(exposed).toEqual([]);
  });
});

describe("KiroImagePreviewDialog", () => {
  function renderDialog(file: File | null) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<KiroImagePreviewDialog file={file} name={file?.name ?? ""} onClose={() => {}} />);
    });
    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { container, cleanup };
  }

  it("打开 → createObjectURL；关闭（unmount）→ revokeObjectURL", () => {
    const file = makeFile();
    const { cleanup } = renderDialog(file);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    // Dialog 经 Portal 渲染到 document.body
    const img = document.body.querySelector('[data-testid="kiro-image-preview"] img');
    expect(img).toBeTruthy();
    cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("file 为 null（历史恢复 / 已移除）→ 不渲染，不创建 URL", () => {
    const { cleanup } = renderDialog(null);
    expect(document.body.querySelector('[data-testid="kiro-image-preview"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    cleanup();
  });

  it("Esc → onClose（无 Esc → 不关闭）", () => {
    const file = makeFile();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<KiroImagePreviewDialog file={file} name="x.png" onClose={onClose} />);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    container.remove();
  });

  it("Backdrop 点击 → onClose；Close Button → onClose", () => {
    const file = makeFile();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<KiroImagePreviewDialog file={file} name="x.png" onClose={onClose} />);
    });
    act(() => {
      (document.body.querySelector('[data-testid="kiro-image-preview-backdrop"]') as HTMLDivElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      (document.body.querySelector('[data-testid="kiro-image-preview-close"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    container.remove();
  });

  it("file 变化 → 旧 URL revoke，新 URL create（不缓存无限 object URL）", () => {
    const f1 = makeFile("1.png");
    const f2 = makeFile("2.png");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let file: File | null = f1;
    const rerender = () => {
      act(() => {
        root.render(<KiroImagePreviewDialog file={file} name={file?.name ?? ""} onClose={() => {}} />);
      });
    };
    rerender();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    file = f2;
    rerender();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    act(() => root.unmount());
    container.remove();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });
});
