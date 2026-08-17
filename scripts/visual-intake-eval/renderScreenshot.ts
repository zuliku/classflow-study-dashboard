/**
 * Visual Intake Eval V1 —— Synthetic Screenshot Renderer（确定性）。
 * 复用 @napi-rs/canvas；不提交真实用户截图、不提交字体文件、不提交 PNG 二进制。
 * 布局参数固定（width/padding/font/bubble）；中文字体依赖系统 fallback，
 * 无法渲染 CJK 时抛 CJK_FONT_UNAVAILABLE（绝不生成 tofu 基准图）。
 */
import { createCanvas, CanvasRenderingContext2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { VisualEvalScreenshot } from "@/lib/ai/eval/visualIntakeScenarios";

export const SCREENSHOT_WIDTH = 420;
const PAD = 18;
const HEADER_H = 40;
const BUBBLE_MAX = SCREENSHOT_WIDTH - PAD * 2 - 80;
const FONT = '12px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';
const FONT_BOLD = '12px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';
const LINE_H = 18;

export class CjkFontUnavailableError extends Error {
  constructor() {
    super("CJK_FONT_UNAVAILABLE");
    this.name = "CjkFontUnavailableError";
  }
}

/** 检测当前系统是否能渲染 CJK（中文字符宽度明显大于 ASCII 占位 → 可用） */
export function cjkFontAvailable(): boolean {
  const c = createCanvas(64, 64);
  const ctx = c.getContext("2d");
  ctx.font = FONT;
  const cjk = ctx.measureText("数").width;
  const ascii = ctx.measureText("A").width;
  return cjk > ascii * 1.2 && cjk > 4;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 确定性渲染：聊天截图（组名 + 日期分隔 + sender + 气泡 + 时间 + 引用）。返回 PNG Buffer。 */
export function renderScreenshot(screenshot: VisualEvalScreenshot): { png: Buffer; width: number; height: number } {
  if (!cjkFontAvailable()) throw new CjkFontUnavailableError();

  // 统一测量上下文（font 与渲染一致 → 换行高度确定性一致）
  const measureCtx = createCanvas(1, 1).getContext("2d");
  measureCtx.font = FONT;

  const messages = screenshot.messages;
  // 预计算高度（确定性布局）
  let height = HEADER_H + PAD;
  if (screenshot.date) height += LINE_H + 8;
  const bubbleLines: number[][] = [];
  for (const m of messages) {
    const textLines = wrapText(measureCtx, m.text, BUBBLE_MAX).length;
    const quoteLines = m.quotedText ? wrapText(measureCtx, m.quotedText, BUBBLE_MAX - 16).length : 0;
    const bodyLines = textLines + (quoteLines > 0 ? quoteLines + 1 : 0);
    bubbleLines.push([bodyLines]);
    height += LINE_H + 6 + bodyLines * LINE_H + 6;
  }
  height += PAD;

  const canvas = createCanvas(SCREENSHOT_WIDTH, height);
  const ctx = canvas.getContext("2d");
  // 背景（聊天面板浅色）
  ctx.fillStyle = "#F2F0ED";
  ctx.fillRect(0, 0, SCREENSHOT_WIDTH, height);

  // 组名 header
  ctx.fillStyle = "#4A4642";
  ctx.font = FONT_BOLD;
  ctx.fillText("计科 2401 班群", PAD, 26);

  let y = HEADER_H;

  // 日期分隔（绝对日期是相对时间解析的 reference）
  if (screenshot.date) {
    y += 8;
    ctx.fillStyle = "#9C968E";
    ctx.font = FONT;
    const dText = screenshot.date.replace("2026-", "").replace(/-/g, "月") + "日";
    ctx.fillText(dText, SCREENSHOT_WIDTH / 2 - ctx.measureText(dText).width / 2, y + 14);
    y += LINE_H;
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    y += 6;
    // sender（左对齐；自己的消息右侧发）
    const isOutgoing = m.direction === "outgoing";
    ctx.fillStyle = "#7A746C";
    ctx.font = FONT;
    const senderText = `${m.sender}${m.time ? ` ${m.time}` : ""}`;
    const senderX = isOutgoing ? SCREENSHOT_WIDTH - PAD - ctx.measureText(senderText).width : PAD;
    ctx.fillText(senderText, senderX, y + 12);
    y += 18;

    // 气泡
    const totalLines = bubbleLines[i][0];
    const bubbleH = totalLines * LINE_H + 14;
    const bubbleW = isOutgoing
      ? Math.min(BUBBLE_MAX, ctx.measureText(m.text).width + 24)
      : Math.min(BUBBLE_MAX, ctx.measureText(m.text).width + 24);
    const bx = isOutgoing ? SCREENSHOT_WIDTH - PAD - bubbleW : PAD;
    ctx.fillStyle = isOutgoing ? "#D8E6CF" : "#FFFFFF";
    // rounded rect
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(bx + r, y);
    ctx.arcTo(bx + bubbleW, y, bx + bubbleW, y + bubbleH, r);
    ctx.arcTo(bx + bubbleW, y + bubbleH, bx, y + bubbleH, r);
    ctx.arcTo(bx, y + bubbleH, bx, y, r);
    ctx.arcTo(bx, y, bx + bubbleW, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#D9D4CC";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 文本
    ctx.fillStyle = "#2E2B28";
    ctx.font = FONT;
    let ty = y + 16;
    if (m.quotedText) {
      // 引用块（旧通知）
      const qLines = wrapText(measureCtx, m.quotedText, BUBBLE_MAX - 16);
      ctx.fillStyle = "#E9E5DE";
      ctx.fillRect(bx + 8, ty - 10, bubbleW - 16, qLines.length * LINE_H + 6);
      ctx.fillStyle = "#8A847B";
      for (const ql of qLines) {
        ctx.fillText(ql, bx + 16, ty + 2);
        ty += LINE_H;
      }
      ty += 4;
      ctx.fillStyle = "#2E2B28";
    }
    for (const tl of wrapText(ctx, m.text, bubbleW - 16)) {
      ctx.fillText(tl, bx + 12, ty);
      ty += LINE_H;
    }
    y += bubbleH + 4;
  }

  const buf = canvas.toBuffer("image/png");
  return { png: buf, width: SCREENSHOT_WIDTH, height };
}

/** 渲染全部场景截图到目录（on-demand；不默认提交 PNG） */
export function renderAllVisualIntakeFixtures(dir: string, scenarios: readonly VisualEvalScreenshot[]): string[] {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  scenarios.forEach((s, i) => {
    const { png } = renderScreenshot(s);
    const file = join(dir, `scenario-${String(i + 1).padStart(2, "0")}.png`);
    writeFileSync(file, png);
    files.push(file);
  });
  return files;
}
