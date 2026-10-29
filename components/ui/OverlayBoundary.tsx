"use client";

import React from "react";
import { useToastStore } from "@/store/useToastStore";

/**
 * OverlayBoundary（全局 Overlay 隔离）：
 * - 单个 Overlay（命令面板 / 设置 / 抽屉 / 弹窗）渲染失败时只卸载该 Overlay，
 *   绝不把整个应用打成「界面加载异常」白屏。
 * - componentDidCatch 只记录 name + message（不含用户数据），并提示用户可重试。
 * - 自动恢复：children 变化（父级重渲染 / HMR 更新）且距上次崩溃超过冷却时间 →
 *   清除错误状态重试一次，避免「崩溃一次后该入口永久打不开」。
 * - Workspace 隔离可传 fallback：渲染替代内容（并提供可见重试入口）；
 *   缺省（Overlay）保持 null 静默卸载。
 */
export interface OverlayBoundaryProps {
  name: string;
  children: React.ReactNode;
  /** 崩溃时渲染的替代内容；缺省 null（Overlay 静默卸载，不遮挡应用） */
  fallback?: React.ReactNode;
  /** 崩溃 toast 文案；缺省按 Overlay 语义提示 */
  errorMessage?: string;
}

export class OverlayBoundary extends React.Component<
  OverlayBoundaryProps,
  { hasError: boolean }
> {
  private lastErrorAt = 0;

  constructor(props: OverlayBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    this.lastErrorAt = Date.now();
    const message = error instanceof Error ? error.message : String(error ?? "");
    console.error(`[classflow:overlay] ${this.props.name} crashed: ${message}`);
    try {
      useToastStore.getState().pushToast({
        message: this.props.errorMessage ?? "这个面板暂时无法打开，请重试。",
        type: "error",
      });
    } catch {
      /* toast 不可用（例如 store 未初始化）时忽略 */
    }
  }

  componentDidUpdate(prevProps: OverlayBoundaryProps): void {
    if (!this.state.hasError) return;
    if (prevProps.children === this.props.children) return;
    // 冷却 1.5s：避免持续错误导致的渲染风暴；冷却后允许一次自动重试
    if (Date.now() - this.lastErrorAt < 1500) return;
    this.setState({ hasError: false });
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
