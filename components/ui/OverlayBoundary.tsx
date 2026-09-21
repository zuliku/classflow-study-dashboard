"use client";

import React from "react";
import { useToastStore } from "@/store/useToastStore";

/**
 * OverlayBoundary（全局 Overlay 隔离）：
 * - 单个 Overlay（命令面板 / 设置 / 抽屉 / 弹窗）渲染失败时只卸载该 Overlay，
 *   绝不把整个应用打成「界面加载异常」白屏。
 * - componentDidCatch 只记录 name + message（不含用户数据），并提示用户可重试。
 */
export class OverlayBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { name: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error ?? "");
    console.error(`[classflow:overlay] ${this.props.name} crashed: ${message}`);
    try {
      useToastStore.getState().pushToast({
        message: "这个面板暂时无法打开，请重试。",
        type: "error",
      });
    } catch {
      /* toast 不可用（例如 store 未初始化）时忽略 */
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
