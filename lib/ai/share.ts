/**
 * Kiro 分享 / 复制 / 导出（本地能力，第一版无云分享）。
 * 内容边界：只包含用户可见消息、Kiro 可见回答、Action Result 摘要。
 * 不含 system prompt / context payload / tool arguments / 内部结果 / API Key / 配置 / 文件全文。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { actionToCardProps, KiroActionCardProps } from "@/components/kiro/KiroActionCard";
import { KiroChatMessageView } from "@/hooks/useKiroChat";

/** Action Card 摘要（可见事实，不含 tool arguments / 内部数据） */
export function actionSummaryText(props: Omit<KiroActionCardProps, "onUndo">): string {
  let s = `${props.heading}：${props.title}`;
  if (props.change) s += `（${props.change.from} → ${props.change.to}）`;
  if (props.bullets && props.bullets.length > 0) s += `；${props.bullets.join("；")}`;
  if (props.footer) s += `；${props.footer}`;
  return s;
}

function actionSummariesOf(m: KiroChatMessageView): string[] {
  return (m.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action)));
}

function attachmentNames(m: KiroChatMessageView): string[] {
  return (m.attachments ?? []).map((a) => `${a.name}${a.kind === "image" ? "（图片）" : ""}`);
}

/** 会话 → Markdown transcript（导出 / 复制 Markdown 用） */
export function buildTranscriptMarkdown(messages: KiroChatMessageView[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      lines.push(`## 你\n\n${m.content}`);
      const atts = attachmentNames(m);
      if (atts.length > 0) lines.push(atts.map((a) => `- 附件：${a}`).join("\n"));
    } else {
      lines.push(`## Kiro\n\n${m.content}`);
      const summaries = actionSummariesOf(m);
      if (summaries.length > 0) lines.push(summaries.map((s) => `- 操作结果：${s}`).join("\n"));
    }
  }
  return lines.join("\n\n") + "\n";
}

/** Markdown source → 纯文本（经真实渲染器提取，含 KaTeX 数学 unicode） */
export function markdownToPlainText(content: string): string {
  if (typeof document === "undefined") return content;
  try {
    const html = renderToStaticMarkup(React.createElement(KiroMarkdown, { content }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return content;
  }
}

/** 会话 → 纯文本 transcript（复制对话用） */
export function buildTranscriptText(messages: KiroChatMessageView[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      lines.push(`你：${markdownToPlainText(m.content)}`);
      const atts = attachmentNames(m);
      if (atts.length > 0) lines.push(`附件：${atts.join("、")}`);
    } else {
      lines.push(`Kiro：${markdownToPlainText(m.content)}`);
      const summaries = actionSummariesOf(m);
      if (summaries.length > 0) lines.push(`操作结果：${summaries.join("；")}`);
    }
  }
  return lines.join("\n\n");
}

/** 复制到剪贴板（clipboard API + execCommand 兜底），返回是否成功 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through 到 execCommand 兜底
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 导出为本地 .md 文件下载（不引入依赖） */
export function downloadMarkdownFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
