import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  triggerArtifactDownload,
  sanitizeDownloadFileName,
  ARTIFACT_DOWNLOAD_URL_REVOKE_DELAY_MS,
} from "@/lib/ai/computer/artifacts/download";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";

const artifact: KiroArtifact = {
  id: "art-1",
  workspaceId: "ws-1",
  rootId: "output",
  relativePath: "报告.docx",
  displayName: "报告.docx",
  type: "docx",
  title: "报告",
  revision: 1,
  source: "kiro-created",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function payload(fileName = "报告.docx", byteLength = 512): { artifact: KiroArtifact; fileName: string; mimeType: string; bytes: Uint8Array } {
  return {
    artifact,
    fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(byteLength).fill(1),
  };
}

describe("triggerArtifactDownload：Blob URL 生命周期", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.fn>;
  let anchorDownload: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    anchorClick = vi.fn();
    anchorDownload = undefined;
    vi.stubGlobal("window", { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    vi.stubGlobal("document", {
      createElement: () => ({
        set href(_v: string) {},
        get href() {
          return "";
        },
        set download(v: string) {
          anchorDownload = v;
        },
        click: anchorClick,
        remove: vi.fn(),
      }),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("click 发生后 revoke 不立即执行；60s 后恰好 revoke 一次", () => {
    triggerArtifactDownload(payload());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ARTIFACT_DOWNLOAD_URL_REVOKE_DELAY_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("Blob 构造 byte-safe：blob 使用 TypedArray（不经 string/base64）", () => {
    const spy = vi.spyOn(URL, "createObjectURL");
    triggerArtifactDownload(payload());
    const blob = spy.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(512);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("下载文件名做展示层清理（扩展名前空格）", () => {
    triggerArtifactDownload(payload("本周课表（第1周） .docx"));
    expect(anchorDownload).toBe("本周课表（第1周）.docx");
  });
});

describe("sanitizeDownloadFileName", () => {
  it("扩展名前多余空格被清理；无空格文件名不变", () => {
    expect(sanitizeDownloadFileName("本周课表（第1周） .docx")).toBe("本周课表（第1周）.docx");
    expect(sanitizeDownloadFileName("报告.docx")).toBe("报告.docx");
    expect(sanitizeDownloadFileName(" 方案 .md")).toBe("方案.md");
    expect(sanitizeDownloadFileName("notes.txt ")).toBe("notes.txt");
  });
});
