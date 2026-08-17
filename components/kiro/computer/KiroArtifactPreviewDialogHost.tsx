"use client";

import React, { useEffect, useState } from "react";
import { Download, Eye, FileText, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { getArtifactPreview, KiroArtifactPreview } from "@/lib/ai/computer/artifacts/access";
import { removeArtifactRecord } from "@/lib/ai/computer/artifacts/service";
import { ComputerError } from "@/lib/ai/computer/errors";
import { cn } from "@/lib/utils";

type PreviewState =
  | { status: "loading" }
  | { status: "success"; preview: KiroArtifactPreview }
  | { status: "missing"; artifactId: string; message: string }
  | { status: "error"; artifactId: string; message: string };

function typeLabel(type: KiroArtifactPreview["artifact"]["type"]): string {
  if (type === "markdown") return "Markdown";
  if (type === "docx") return "Word";
  return "文本";
}

/**
 * 全局 Artifact Preview Host（V2 Part 3）：只挂载一次（KiroSessionProvider）。
 * - 预览/下载是用户显式 UI Read：不写 audit、不消耗 Computer quota、无 Approval。
 * - Markdown 用现有 KiroMarkdown（无 raw HTML）；DOCX 只有结构事实 + bounded raw text（无 HTML）。
 * - missing：只提供「移除失效记录」（只删 Registry + Source，绝不删文件系统内容）。
 */
export function KiroArtifactPreviewDialogHost() {
  const previewArtifactId = useKiroArtifactUiStore((s) => s.previewArtifactId);
  const closePreview = useKiroArtifactUiStore((s) => s.closePreview);
  const { downloadArtifact } = useKiroArtifactActions();
  const [state, setState] = useState<PreviewState | null>(null);
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!previewArtifactId) {
      setState(null);
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    setTab("preview");
    void (async () => {
      try {
        const workspaces = useKiroComputerStore.getState().workspaces;
        const preview = await getArtifactPreview({ artifactId: previewArtifactId, workspaces });
        if (alive) setState({ status: "success", preview });
      } catch (err) {
        if (!alive) return;
        if (err instanceof ComputerError && err.code === "RESOURCE_NOT_FOUND") {
          setState({ status: "missing", artifactId: previewArtifactId, message: "文件不存在" });
        } else {
          setState({
            status: "error",
            artifactId: previewArtifactId,
            message: err instanceof Error ? err.message : "预览失败",
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [previewArtifactId]);

  const handleRemoveStale = async () => {
    if (!state || state.status !== "missing" || removing) return;
    setRemoving(true);
    try {
      await removeArtifactRecord(state.artifactId);
      closePreview();
    } catch {
      setRemoving(false);
    }
  };

  const open = previewArtifactId !== null;
  const preview = state?.status === "success" ? state.preview : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closePreview();
      }}
      overlayId="kiro-artifact-preview"
      stackZ={85}
      className="max-w-3xl"
    >
      <div data-testid="kiro-artifact-preview-dialog" className="flex flex-col max-h-[82vh]">
        {/* Header */}
        <div className="flex items-start gap-2.5 p-4 pb-3 border-b border-line">
          <span className="w-8 h-8 rounded-full bg-pastel-mint/60 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-charcoal" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            {preview ? (
              <>
                <h2 className="text-sm font-bold text-charcoal truncate">
                  {preview.artifact.displayName}
                  {preview.artifact.revision > 1 ? ` · v${preview.artifact.revision}` : ""}
                </h2>
                <p className="text-[11px] text-sandrift truncate">
                  {typeLabel(preview.artifact.type)} · {preview.workspaceLabel} / {preview.rootLabel}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-sm font-bold text-charcoal truncate">文件预览</h2>
                <p className="text-[11px] text-sandrift truncate">
                  {state?.status === "missing" || state?.status === "error" ? state.message : "加载中…"}
                </p>
              </>
            )}
          </div>
          <button
            onClick={closePreview}
            aria-label="关闭"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {state?.status === "loading" && (
            <p className="text-[11px] text-sandrift" data-testid="kiro-preview-loading">
              正在读取文件…
            </p>
          )}

          {state?.status === "missing" && (
            <div className="space-y-3">
              <p className="text-xs text-satin-grey">
                Artifact 记录仍存在，但工作区中已找不到该文件（文件系统是事实来源）。
              </p>
              <Button variant="danger" size="sm" onClick={() => void handleRemoveStale()} disabled={removing}>
                <Trash2 className="w-3 h-3" />
                {removing ? "移除中…" : "移除失效记录"}
              </Button>
              <p className="text-[10px] text-sandrift">只删除 Artifact 元数据与文档源，不会删除任何文件。</p>
            </div>
          )}

          {state?.status === "error" && (
            <p className="text-xs text-danger" data-testid="kiro-preview-error">
              {state.message}
            </p>
          )}

          {preview && (
            <div className="space-y-3" style={{ "--kiro-output-font-size": "14px" } as React.CSSProperties}>
              {preview.kind === "markdown" && (
                <>
                  <div className="flex items-center gap-1 w-fit bg-[#F7F5F5] border border-line rounded-lg p-0.5">
                    <button
                      onClick={() => setTab("preview")}
                      aria-pressed={tab === "preview"}
                      className={cn(
                        "px-2.5 h-6 rounded-md text-[11px] font-semibold transition-colors",
                        tab === "preview" ? "bg-white text-charcoal shadow-subtle" : "text-sandrift"
                      )}
                    >
                      预览
                    </button>
                    <button
                      onClick={() => setTab("source")}
                      aria-pressed={tab === "source"}
                      className={cn(
                        "px-2.5 h-6 rounded-md text-[11px] font-semibold transition-colors",
                        tab === "source" ? "bg-white text-charcoal shadow-subtle" : "text-sandrift"
                      )}
                    >
                      源码
                    </button>
                  </div>
                  {tab === "preview" ? (
                    <div className="rounded-xl border border-line bg-surface p-3">
                      <KiroMarkdown content={preview.text} />
                    </div>
                  ) : (
                    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface p-3 text-[12px] text-satin-grey leading-relaxed">
                      {preview.text}
                    </pre>
                  )}
                </>
              )}

              {preview.kind === "text" && (
                <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface p-3 text-[12px] font-mono text-satin-grey leading-relaxed">
                  {preview.text}
                </pre>
              )}

              {preview.kind === "docx" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-line bg-[#F7F5F5] p-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {preview.facts.title && (
                      <p className="col-span-2 text-xs font-bold text-charcoal">{preview.facts.title}</p>
                    )}
                    <Fact label="章节标题" value={preview.facts.headings} />
                    <Fact label="段落" value={preview.facts.paragraphs} />
                    <Fact label="列表" value={preview.facts.lists} />
                    <Fact label="表格" value={preview.facts.tables} />
                    <Fact label="代码块" value={preview.facts.codeBlocks} />
                    <Fact label="字符数" value={preview.facts.characters} />
                  </div>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface p-3 text-[12px] text-satin-grey leading-relaxed">
                    {preview.text || "（未能提取正文）"}
                  </pre>
                </div>
              )}

              {preview.truncated && (
                <p className="text-[10px] text-sandrift" data-testid="kiro-preview-truncated">
                  内容较长，仅显示前 {100_000} 字符。
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {preview && (
          <div className="flex items-center justify-end gap-2 p-4 pt-3 border-t border-line">
            <Button variant="primary" size="sm" onClick={() => void downloadArtifact(preview.artifact.id)}>
              <Download className="w-3 h-3" />
              下载
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <p className="text-[11px] text-satin-grey">
      <span className="text-sandrift mr-1.5">{label}</span>
      <span className="font-semibold text-charcoal">{value}</span>
    </p>
  );
}
