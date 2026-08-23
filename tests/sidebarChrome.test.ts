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

describe("Sidebar motion decoupling — Task 16B T/U/V/W", () => {
  it("Sidebar.tsx 实现 visualCollapsed 与 persistedCollapsed 解耦（pending + transitionend 持久化）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/layout/Sidebar.tsx"), "utf-8");
    // 必须存在 visualCollapsed / persistedCollapsed / pendingCollapsedRef
    expect(src).toContain("visualCollapsed");
    expect(src).toContain("persistedCollapsed");
    expect(src).toContain("pendingCollapsedRef");
    // toggle 立即 setVisualCollapsed，不同步 persist；reducedMotion 分支立即持久化
    expect(src).toContain("setVisualCollapsed(next)");
    expect(src).toContain("setPersistedCollapsed");
    // transitionend(width) 后才持久化 pending
    expect(src).toContain('propertyName !== "width"');
    expect(src).toContain("pendingCollapsedRef.current !== null");
    // 第一帧不做同步 persistence（注释或逻辑）
    expect(src).toMatch(/第一帧|立即.*visual|不.*persist/i);
  });

  it("减少 layout-property tween：Shell 仅 width，Label 仅 opacity/transform，padding/gap 瞬时", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf-8");
    // sidebar-nav-row 不应有 230ms padding/gap tween
    const navRowBlock = css.match(/\.sidebar-nav-row\s*\{[^}]+\}/)?.[0] ?? "";
    expect(navRowBlock).not.toContain("transition-property: padding");
    // nav row should not transition gap via transition-property (gap itself is okay as static)
    expect(navRowBlock).not.toMatch(/transition-property:[^;]*gap/);
    // Label 仅 opacity/transform，不含 max-width 持续 tween
    expect(css).toContain("transition-property: opacity, transform;");
    // Shell 仍保留 width transition
    expect(css).toContain(".sidebar-shell");
    expect(css).toMatch(/transition-property:\s*width/);
  });

  it("不使用 transform scale 模拟 Sidebar（保持 64px/224px 几何，图标光学居中）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf-8");
    // 不应出现 scaleX(sidebar) 或 scale(sidebar)
    expect(css).not.toMatch(/scaleX\s*\(/);
    // sidebar-shell 应为 w-16 / w-56（由组件控制），css 中不应有 transform scale 模拟
    const sidebarSrc = fs.readFileSync(path.join(process.cwd(), "components/layout/Sidebar.tsx"), "utf-8");
    expect(sidebarSrc).toContain("w-16");
    expect(sidebarSrc).toContain("w-56");
    expect(sidebarSrc).not.toContain("scaleX");
  });

  it("observers：ResizeObserver 冻结期间不重复 measure，transitionend width 单次完成，无 timer 双触发", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/layout/Sidebar.tsx"), "utf-8");
    expect(src).toContain("motionActiveRef.current");
    expect(src).toContain("if (motionActiveRef.current) return");
    expect(src).toContain('if (e.propertyName !== "width") return');
    // 确保没有同时使用 timer + transitionend 双完成（无 setTimeout 完成 morph）
    // 允许 requestAnimationFrame 用于 plate 校正，但不应有 setTimeout 触发 persisted 写入
    const hasTimeoutPersist = /setTimeout\([^)]*setPersistedCollapsed/.test(src);
    expect(hasTimeoutPersist).toBe(false);
  });

  it("Reduced Motion 瞬时切换（不进 motionActive）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/layout/Sidebar.tsx"), "utf-8");
    expect(src).toContain("reducedMotion");
    expect(src).toContain("setVisualCollapsed(next)");
    // reduced branch should set motionActive false
    expect(src).toMatch(/if\s*\(reducedMotion\)[\s\S]*setMotionActive\(false\)/);
  });
});

describe("Kiro Featured 双层 perimeter（V2.3 polish）static guard", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("Sidebar Featured Entry：存在 base ring 层 + animated ring 层 + 内容层", () => {
    const src = read("components/layout/Sidebar.tsx");
    expect(src).toContain("sidebar-kiro-base-ring");
    expect(src).toContain("kiro-ring kiro-featured-flow");
    // inner surface：2px 环宽几何（outer rounded-xl 14px − 2 = 12px）
    expect(src).toContain("m-[2px]");
    expect(src).toContain("w-[calc(100%-4px)]");
    expect(src).toContain("rounded-[12px]"); // outer 14 − ring 2 = inner 12
  });

  it("scoped hover/focus 规则存在（不再依赖 group-hover 竞争）", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.sidebar-kiro:hover \.kiro-featured-flow/);
    expect(css).toMatch(/\.sidebar-kiro:focus-visible \.kiro-featured-flow/);
    expect(css).toContain(".sidebar-kiro-base-ring {");
  });

  it("Reduced Motion：仅停动画，base ring 不被移除", () => {
    const css = read("app/globals.css");
    const reduced = css.match(
      /html\[data-motion-effective="reduced"\] \.kiro-featured-flow[^{]*\{[^}]*\}/
    );
    expect(reduced).toBeTruthy();
    expect(reduced![0]).not.toContain("display: none");
    expect(reduced![0]).toContain("animation: none");
  });
});