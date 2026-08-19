import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * UI Chrome 偏好（低成本 UI state）：
 * - 独立持久化 key（classflow-ui-chrome），绝不触发主业务 store（classflow-storage-v2）全量 persist。
 * - 首次创建（无新 key 数据）时从旧主 store 迁移 sidebarCollapsed，保证老用户折叠偏好不丢失。
 * - 业务组件（Sidebar）只订阅此 store，不再订阅 useAppStore.sidebarCollapsed。
 */

const UI_CHROME_KEY = "classflow-ui-chrome";
const LEGACY_MAIN_KEY = "classflow-storage-v2";

/** 旧主 store 迁移 fallback：新 UI Chrome 无数据时读取 classflow-storage-v2.state.sidebarCollapsed */
export function migrateLegacySidebarCollapsed(): boolean {
  try {
    if (typeof globalThis.localStorage === "undefined") return false;
    const raw = globalThis.localStorage.getItem(LEGACY_MAIN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { sidebarCollapsed?: boolean } };
    return parsed?.state?.sidebarCollapsed === true;
  } catch {
    return false;
  }
}

interface UIChromeState {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUIChromeStore = create<UIChromeState>()(
  persist(
    (set) => ({
      sidebarCollapsed: migrateLegacySidebarCollapsed(),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: UI_CHROME_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);
