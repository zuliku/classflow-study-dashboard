import React from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import App from "@/app/page";
import { TitleBar } from "@/src/renderer/components/TitleBar";

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

createRoot(container).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      {/* 桌面版窗口结构：自绘标题栏 + 应用内容（TitleBar 固定在视口顶部）。
          只有此处允许 h-screen（viewport 高度 owner）；TitleBar 以下全部用 flex-1/min-h-0 继承剩余高度 */}
      <div className="h-screen flex flex-col overflow-hidden">
        <TitleBar />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <App />
        </div>
      </div>
    </RendererErrorBoundary>
  </React.StrictMode>
);
