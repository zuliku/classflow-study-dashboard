import React from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import App from "@/app/page";
import { TitleBar } from "@/src/renderer/components/TitleBar";

const container = document.getElementById("root");
if (!container) throw new Error("root 容器不存在");

createRoot(container).render(
  <React.StrictMode>
    {/* 桌面版窗口结构：自绘标题栏 + 应用内容（TitleBar 固定在视口顶部）。
        只有此处允许 h-screen（viewport 高度 owner）；TitleBar 以下全部用 flex-1/min-h-0 继承剩余高度 */}
    <div className="h-screen flex flex-col overflow-hidden">
      <TitleBar />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <App />
      </div>
    </div>
  </React.StrictMode>
);
