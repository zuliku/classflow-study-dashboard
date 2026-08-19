import { describe, it, expect, beforeEach, beforeAll } from "vitest";

/**
 * Sidebar Chrome 性能保障测试（Phase 2 Motion Performance Closure）：
 * 1. shouldUpdatePlate：相同 y/h 不产生 state update（避免无意义 React commit）
 * 2. UI Chrome Store：sidebarCollapsed 独立持久化（classflow-ui-chrome），不触碰业务 store
 * 3. migration：新 UI Chrome 无数据时从旧 classflow-storage-v2.sidebarCollapsed 迁移
 */

let shouldUpdatePlate: (prev: { y: number; h: number } | null, next: { y: number; h: number }) => boolean;
let migrateLegacy: () => boolean;
let useUIChromeStore: typeof import("@/store/useUIChromeStore").useUIChromeStore;

beforeAll(async () => {
  // node 环境：先装 localStorage polyfill，再动态加载 store 链（persist 初始化依赖 localStorage）
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
  ({ shouldUpdatePlate } = await import("@/components/layout/Sidebar"));
  ({ migrateLegacySidebarCollapsed: migrateLegacy } = await import("@/store/useUIChromeStore"));
  ({ useUIChromeStore } = await import("@/store/useUIChromeStore"));
});

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("shouldUpdatePlate（相同 y/h 不 setState）", () => {
  it("相同 y/h → false（跳过 state update）", () => {
    expect(shouldUpdatePlate({ y: 10, h: 40 }, { y: 10, h: 40 })).toBe(false);
  });
  it("首次（prev null）→ 必须更新", () => {
    expect(shouldUpdatePlate(null, { y: 10, h: 40 })).toBe(true);
  });
  it("y 或 h 任一变化 → true", () => {
    expect(shouldUpdatePlate({ y: 10, h: 40 }, { y: 11, h: 40 })).toBe(true);
    expect(shouldUpdatePlate({ y: 10, h: 40 }, { y: 10, h: 41 })).toBe(true);
  });
});

describe("UI Chrome Store：独立持久化（不触碰业务 store）", () => {
  it("setSidebarCollapsed 写入独立 key classflow-ui-chrome", () => {
    useUIChromeStore.getState().setSidebarCollapsed(true);
    const raw = globalThis.localStorage.getItem("classflow-ui-chrome");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state?: { sidebarCollapsed?: boolean } };
    expect(parsed?.state?.sidebarCollapsed).toBe(true);
    // 业务 store key 不因 UI Chrome 写入而出现
    expect(globalThis.localStorage.getItem("classflow-storage-v2")).toBeNull();
  });

  it("rehydrate：重启后折叠偏好保留", async () => {
    // 内存先为 false（setState 会被 persist 拦截写入 storage false，随后手动覆盖为上一会话的 true）
    useUIChromeStore.setState({ sidebarCollapsed: false });
    globalThis.localStorage.setItem(
      "classflow-ui-chrome",
      JSON.stringify({ state: { sidebarCollapsed: true }, version: 0 })
    );
    await useUIChromeStore.persist.rehydrate();
    expect(useUIChromeStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe("migration：旧主 store sidebarCollapsed → UI Chrome initial value", () => {
  it("旧 classflow-storage-v2.sidebarCollapsed=true → 迁移为 true", () => {
    globalThis.localStorage.setItem(
      "classflow-storage-v2",
      JSON.stringify({ state: { sidebarCollapsed: true } })
    );
    expect(migrateLegacy()).toBe(true);
  });

  it("旧数据缺失 / 非 true → false", () => {
    expect(migrateLegacy()).toBe(false);
    globalThis.localStorage.setItem("classflow-storage-v2", JSON.stringify({ state: {} }));
    expect(migrateLegacy()).toBe(false);
  });

  it("损坏 JSON → false（不抛错）", () => {
    globalThis.localStorage.setItem("classflow-storage-v2", "{broken");
    expect(migrateLegacy()).toBe(false);
  });
});
