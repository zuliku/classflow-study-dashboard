// @vitest-environment jsdom
/**
 * Visual Intake V1.5.1（P0）：Live Image Registry 异步 ghost source 竞态修复。
 * 根因：旧实现先 await createImageThumbnail 再 registerLiveImageSource ——
 *   Remove → unregister / Conversation clear → clearLiveImageSources 之后，
 *   async thumbnail 完成仍会重新注册被移除 / 旧会话的图片。
 * 修复：所有 image File 在**任何 image await 之前**完成 initial registration；
 *   thumbnail 完成只走 updateLiveImageSourceThumbnail（已存在才更新，no-op 绝不重建）；
 *   thumbnail 失败 → unregister。
 * 本测试挂载真实 useKiroAttachments（mock createImageThumbnail 为受控 deferred）。
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useKiroAttachments } from "@/hooks/useKiroAttachments";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import {
  resolveLiveImageSource,
  resolveLiveImageSources,
  clearLiveImageSources,
} from "@/lib/ai/attachments/liveImageRegistry";

const mocks = vi.hoisted(() => ({
  createThumbnail: vi.fn(),
  toast: { pushToast: vi.fn() },
}));

vi.mock("@/lib/ai/attachments/image", () => ({
  createImageThumbnail: (file: File) => mocks.createThumbnail(file),
}));

vi.mock("@/store/useToastStore", () => ({
  useToastStore: (sel: (s: { pushToast: unknown }) => unknown) => sel({ pushToast: mocks.toast.pushToast }),
}));

interface HarnessApi {
  addFiles: ((files: File[]) => Promise<void>) | null;
  remove: ((id: string) => void) | null;
  views: KiroAttachmentView[];
}

function Harness({ api }: { api: HarnessApi }) {
  const att = useKiroAttachments();
  api.addFiles = att.addFiles;
  api.remove = att.remove;
  api.views = att.views;
  return null;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFile(name = "a.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveImageSources();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearLiveImageSources();
  document.body.innerHTML = "";
});

function mount() {
  const api: HarnessApi = { addFiles: null, remove: null, views: [] };
  act(() => {
    root.render(<Harness api={api} />);
  });
  return api;
}

describe("V1.5.1 ghost source race（useKiroAttachments 真实流程）", () => {
  it("所有 image File 在任何 image await 前完成 initial registration（多图预注册）", async () => {
    const api = mount();
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    mocks.createThumbnail.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    let pending: Promise<void>;
    act(() => {
      pending = api.addFiles!([makeFile("1.png"), makeFile("2.png")]);
    });
    // img1 的 thumbnail 尚在 pending —— img2 必须在 registry 中（预注册；否则 clear 后 img2 仍会复活）
    const ids = api.views.map((v) => v.id);
    expect(ids).toHaveLength(2);
    expect(resolveLiveImageSources(ids)).toHaveLength(2);
    expect(resolveLiveImageSource(ids[1])?.name).toBe("2.png");
    d1.resolve("data:image/png;base64,T1");
    d2.resolve("data:image/png;base64,T2");
    await act(async () => {
      await pending;
    });
    expect(resolveLiveImageSource(ids[1])?.thumbnail).toBe("data:image/png;base64,T2");
  });

  it("remove while thumbnail pending → source 不得复活", async () => {
    const api = mount();
    const d = deferred<string>();
    mocks.createThumbnail.mockReturnValue(d.promise);
    let pending: Promise<void>;
    act(() => {
      pending = api.addFiles!([makeFile("a.png")]);
    });
    const id = api.views[0].id;
    expect(resolveLiveImageSource(id)).toBeTruthy(); // 预注册立即可见
    act(() => {
      api.remove!(id);
    });
    expect(resolveLiveImageSource(id)).toBeUndefined();
    // async thumbnail 迟到完成 → no-op（不复活）
    d.resolve("data:image/png;base64,LATE");
    await act(async () => {
      await pending;
    });
    expect(resolveLiveImageSource(id)).toBeUndefined();
  });

  it("conversation clear while thumbnail pending → source 不得复活", async () => {
    const api = mount();
    const d = deferred<string>();
    mocks.createThumbnail.mockReturnValue(d.promise);
    let pending: Promise<void>;
    act(() => {
      pending = api.addFiles!([makeFile("a.png")]);
    });
    const id = api.views[0].id;
    expect(resolveLiveImageSource(id)).toBeTruthy();
    // 模拟 load/new Conversation B（useKiroChat 同点调用）
    clearLiveImageSources();
    d.resolve("data:image/png;base64,LATE");
    await act(async () => {
      await pending;
    });
    expect(resolveLiveImageSource(id)).toBeUndefined();
  });

  it("multiple images + clear during first thumbnail → img1/img2 都不得重新进入 Registry", async () => {
    const api = mount();
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    mocks.createThumbnail.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    let pending: Promise<void>;
    act(() => {
      pending = api.addFiles!([makeFile("1.png"), makeFile("2.png")]);
    });
    const ids = api.views.map((v) => v.id);
    expect(resolveLiveImageSources(ids)).toHaveLength(2);
    // img1 thumbnail pending 时切换到 Conversation B
    clearLiveImageSources();
    expect(resolveLiveImageSources(ids)).toHaveLength(0);
    // 两个 thumbnail 都迟到完成 → 不得复活
    d1.resolve("data:image/png;base64,LATE1");
    d2.resolve("data:image/png;base64,LATE2");
    await act(async () => {
      await pending;
    });
    expect(resolveLiveImageSources(ids)).toHaveLength(0);
  });

  it("thumbnail failure → registry clean + 附件 error", async () => {
    const api = mount();
    mocks.createThumbnail.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await api.addFiles!([makeFile("a.png")]);
    });
    const id = api.views[0].id;
    expect(api.views[0].status).toBe("error");
    expect(api.views[0].error).toContain("无法生成预览");
    expect(resolveLiveImageSource(id)).toBeUndefined();
  });

  it("normal ready path unchanged：thumbnail 完成 → entry 带 thumbnail + ready", async () => {
    const api = mount();
    mocks.createThumbnail.mockResolvedValue("data:image/png;base64,OK");
    await act(async () => {
      await api.addFiles!([makeFile("a.png")]);
    });
    const id = api.views[0].id;
    expect(api.views[0].status).toBe("ready");
    const entry = resolveLiveImageSource(id);
    expect(entry).toBeTruthy();
    expect(entry?.thumbnail).toBe("data:image/png;base64,OK");
    expect(entry?.name).toBe("a.png");
  });
});
