import React from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import App from "@/app/page";
import { TitleBar } from "@/src/renderer/components/TitleBar";

const container = document.getElementById("root");
if (!container) throw new Error("root 容器不存在");

/**
 * 桌面版首次启动：与本地网页预览一致的测试数据体验。
 * 注入条件：设备上没有注入过当前版本的 demo，且当前没有真实业务数据
 * （persist 可能在早期版本留下空壳 storage，按"无有效数据"处理，同样注入）。
 * 注入标记带版本号：demo 数据更新（如排课调整）后，旧标记的设备会重新注入，
 * 但已产生真实数据（非纯 demo）的设备不会被覆盖。
 */
const DEMO_INJECT_VERSION = "v3";

async function injectDemoDataOnFirstRun(): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    const injected = localStorage.getItem("classflow-demo-injected");
    const raw = localStorage.getItem("classflow-storage-v2");

    let hasRealData = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const obj = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
        const st =
          (typeof obj.state === "object" && obj.state !== null ? obj.state : obj) as Record<string, unknown>;
        hasRealData =
          (Array.isArray(st.courses) && st.courses.length > 0) ||
          (Array.isArray(st.assignments) && st.assignments.length > 0) ||
          (Array.isArray(st.schedules) && st.schedules.length > 0);
      } catch {
        /* 无法解析视为空壳 */
      }
    }

    if (injected === DEMO_INJECT_VERSION || hasRealData) {
      console.info(
        "[classflow] 跳过演示数据注入 (demoFresh=%s hasRealData=%s)",
        injected === DEMO_INJECT_VERSION,
        hasRealData
      );
      return;
    }

    const [{ buildFullDemoData }, { useAppStore }] = await Promise.all([
      import("@/lib/dev/fullDemoData"),
      import("@/store/useAppStore"),
    ]);
    useAppStore.getState().restoreAppData(buildFullDemoData());
    localStorage.setItem("classflow-demo-injected", DEMO_INJECT_VERSION);
    console.info("[classflow] 演示数据注入完成 (v%s)", DEMO_INJECT_VERSION);
  } catch (err) {
    console.error("[classflow] 演示数据注入失败:", err);
  }
}

void injectDemoDataOnFirstRun().finally(() => {
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
});
