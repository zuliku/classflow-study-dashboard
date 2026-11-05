import React from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import App from "@/app/page";
import { TitleBar } from "@/src/renderer/components/TitleBar";
import { MiniChatApp } from "@/components/kiro/mini/MiniChatApp";
import { isMiniModeSearch } from "@/lib/ai/miniChat/protocol";

class RendererErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: unknown }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }
  componentDidCatch(error: unknown, info: unknown) {
    // 生产白屏兜底：仅日志，不暴露敏感路径
    console.error("[classflow:renderer] uncaught", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-4 p-8 bg-background text-charcoal">
          <div className="text-lg font-semibold">界面加载异常</div>
          <div className="text-sm text-satin-grey max-w-md text-center break-words">
            {this.state.error instanceof Error ? this.state.error.message : String(this.state.error ?? "")}
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-charcoal text-white text-sm hover:opacity-90"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("root 容器不存在");

// Kiro Mini 常驻窗：同一包按 `?mini=1` 渲染瘦客户端（无 TitleBar/App，无聊天运行时；
// 真相在主窗口，中继见 MiniChatRelayHost + src/main/miniChat.ts）。
const miniMode = typeof window !== "undefined" && isMiniModeSearch(window.location.search);
if (miniMode) {
  // Mini 窗口是透明的：卡片形变在固定尺寸窗口内完成，卡片外的区域必须透出桌面。
  document.documentElement.dataset.mini = "1";
}

createRoot(container).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      {miniMode ? (
        <div className="h-screen flex flex-col overflow-hidden">
          <MiniChatApp />
        </div>
      ) : (
        <div className="h-screen flex flex-col overflow-hidden">
          <TitleBar />
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <App />
          </div>
        </div>
      )}
    </RendererErrorBoundary>
  </React.StrictMode>
);
