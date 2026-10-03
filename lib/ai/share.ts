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
import { citationsToReadableText } from "@/lib/ai/citations/parser";

/** Action Card 摘要（可见事实，不含 tool arguments / 内部数据） */
export function actionSummaryText(props: Omit<KiroActionCardProps, "onUndo" | "entering">): string {
  let s = `${props.heading}：${props.title}`;
  if (props.change) s += `（${props.change.from} → ${props.change.to}）`;
  if (props.bullets && props.bullets.length > 0) s += `；${props.bullets.join("；")}`;
  if (props.footer) s += `；${props.footer}`;
  return s;
}

function actionSummariesOf(m: KiroChatMessageView): string[] {
  const live = (m.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action)));
  const restored = (m.historyActions ?? []).map((a) =>
    actionSummaryText(a as Parameters<typeof actionSummaryText>[0])
  );
  return [...live, ...restored];
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
      lines.push(`## Kiro\n\n${citationsToReadableText(m.content, m.sources)}`);
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

/**
 * 纯字符串 markdown 脱壳（transcript 快路径；不走 React/KaTeX 渲染）。
 * 保留全部文字内容（含代码与公式原文），只去标记。长会话复制/导出时避免
 * 每条消息全量渲染（KaTeX + highlight）造成秒级主线程冻结。
 */
export function stripMarkdownToPlainText(content: string): string {
  return (
    content
      // fenced code：去围栏留原文
      .replace(/^```[^\n]*\n([\s\S]*?)\n```/gm, "$1")
      // 行内代码去反引号留原文
      .replace(/`([^`\n]+)`/g, "$1")
      // 图片 ![a](u) → a；链接 [t](u) → t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 标题/引用/列表标记
      .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
      // 加粗/斜体标记（数学下划线在公式内，无 $ 包裹的裸 _ 误删风险低，属快速路径可接受；
      // 单个 * 仅两侧非词字符时脱壳（2*3 这类乘法不动，中文和*斜体*可脱））
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(^|[^A-Za-z0-9_*])\*([^*\n]+)\*(?![A-Za-z0-9_*])/g, "$1$2")
      // 表格行（首尾竖线包裹的行）内部竖线转空格；行内零散竖线（如代码 a||b）保持原样
      .replace(/^\s*\|(.*)\|\s*$/gm, (_line, inner: string) => ` ${String(inner).replace(/\|/g, "  ")} `)
      // 行内 HTML 标签
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** 全会话字符量超过此值时 transcript 走字符串快路径（单条复制仍走渲染器保质量） */
export const TRANSCRIPT_FAST_PATH_CHARS = 100_000;

/** 会话 → 纯文本 transcript（复制对话用） */
export function buildTranscriptText(messages: KiroChatMessageView[]): string {
  // 长会话快路径：逐条全量渲染会冻结主线程；超限改用字符串脱壳（单条复制不受影响）
  const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  const toText =
    totalChars > TRANSCRIPT_FAST_PATH_CHARS ? stripMarkdownToPlainText : markdownToPlainText;
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      lines.push(`你：${toText(m.content)}`);
      const atts = attachmentNames(m);
      if (atts.length > 0) lines.push(`附件：${atts.join("、")}`);
    } else {
      lines.push(`Kiro：${toText(citationsToReadableText(m.content, m.sources))}`);
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
