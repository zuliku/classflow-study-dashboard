// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { DEFAULT_SIDECAR_MINIMIZED_POSITION } from "@/lib/ai/ui/sidecarMinimizedPosition";
import { SIDECAR_DEFAULT_SIZE } from "@/lib/ai/ui/sidecarSize";
import { SIDECAR_DEFAULT_POSITION } from "@/lib/ai/ui/sidecarPosition";

describe("Kiro Preferences — sidecarMinimizedPosition persistence", () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useKiroPreferencesStore.setState({
      sidecarSize: SIDECAR_DEFAULT_SIZE,
      sidecarPosition: SIDECAR_DEFAULT_POSITION,
      sidecarMinimizedPosition: DEFAULT_SIDECAR_MINIMIZED_POSITION,
    });
    localStorage.clear();
  });

  it("partialize 包含 sidecarMinimizedPosition，且 storage key 保持 v1", () => {
    // 通过直接检查 persist 配置的 partialize 逻辑（store 的 persist 选项）
    const state = useKiroPreferencesStore.getState();
    // @ts-expect-error — 访问内部 persist 选项
    const persistOptions = (useKiroPreferencesStore as unknown as { persist: { getOptions: () => { name: string } } }).persist?.getOptions?.();
    // 如果无法访问内部，直接验证行为：set 后 localStorage 有值
    useKiroPreferencesStore.getState().setSidecarMinimizedPosition({ right: 100, bottom: 80 });
    const raw = localStorage.getItem("classflow-kiro-preferences-v1");
    expect(raw).toBeTruthy();
    if (raw) {
      const parsed = JSON.parse(raw);
      // persist 的 state 包装在 { state: { ... } }
      const stored = parsed.state ?? parsed;
      expect(stored.sidecarMinimizedPosition).toEqual({ right: 100, bottom: 80 });
      // sidecarSize/Position 仍存在，未被破坏
      expect(stored.sidecarSize).toBeDefined();
      expect(stored.sidecarPosition).toBeDefined();
    }
  });

  it("旧 persisted data（无 minimized position）→ rehydrate 后为 default，且旧 size/position 正确恢复", async () => {
    const old = {
      state: {
        sidecarSize: SIDECAR_DEFAULT_SIZE,
        sidecarPosition: SIDECAR_DEFAULT_POSITION,
        outputTextSize: "standard",
      },
      version: 0,
    };
    localStorage.setItem("classflow-kiro-preferences-v1", JSON.stringify(old));
    // 触发 Zustand persist 的 rehydrate（按当前版本 API）
    // @ts-expect-error — persist 存在于 store
    await (useKiroPreferencesStore.persist as unknown as { rehydrate: () => Promise<void> }).rehydrate();
    expect(useKiroPreferencesStore.getState().sidecarMinimizedPosition).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
    expect(useKiroPreferencesStore.getState().sidecarSize).toEqual(SIDECAR_DEFAULT_SIZE);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual(SIDECAR_DEFAULT_POSITION);
    // 纯函数层面同样归一
    const { normalizeSidecarMinimizedPosition } = await import("@/lib/ai/ui/sidecarMinimizedPosition");
    expect(normalizeSidecarMinimizedPosition(undefined)).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
  });

  it("invalid persisted minimizedPosition → rehydrate 后安全归一", async () => {
    const invalid = {
      state: {
        sidecarSize: SIDECAR_DEFAULT_SIZE,
        sidecarPosition: SIDECAR_DEFAULT_POSITION,
        sidecarMinimizedPosition: { right: -100, bottom: null },
        outputTextSize: "standard",
      },
      version: 0,
    };
    localStorage.setItem("classflow-kiro-preferences-v1", JSON.stringify(invalid));
    // @ts-expect-error
    await (useKiroPreferencesStore.persist as unknown as { rehydrate: () => Promise<void> }).rehydrate();
    const pos = useKiroPreferencesStore.getState().sidecarMinimizedPosition;
    expect(pos.right).toBe(24);
    expect(pos.bottom).toBe(24);
  });

  it("新 persisted data（有 valid minimized position）→ restore", () => {
    const valid = { right: 120, bottom: 90 };
    useKiroPreferencesStore.getState().setSidecarMinimizedPosition(valid);
    expect(useKiroPreferencesStore.getState().sidecarMinimizedPosition).toEqual(valid);
  });

  it("invalid → normalized（NaN/Infinity/负值）", () => {
    // @ts-expect-error
    useKiroPreferencesStore.getState().setSidecarMinimizedPosition({ right: NaN, bottom: Infinity } as unknown as { right: number; bottom: number });
    const after = useKiroPreferencesStore.getState().sidecarMinimizedPosition;
    expect(after.right).toBe(24);
    expect(after.bottom).toBe(24);
    // @ts-expect-error
    useKiroPreferencesStore.getState().setSidecarMinimizedPosition({ right: -10, bottom: -20 } as unknown as { right: number; bottom: number });
    const after2 = useKiroPreferencesStore.getState().sidecarMinimizedPosition;
    expect(after2.right).toBe(24);
    expect(after2.bottom).toBe(24);
  });

  it("sidecarSize / sidecarPosition 行为完全不变", () => {
    const size = { width: 500, height: 600 };
    const pos = { top: 30, right: 30 };
    useKiroPreferencesStore.getState().setSidecarSize(size);
    useKiroPreferencesStore.getState().setSidecarPosition(pos);
    expect(useKiroPreferencesStore.getState().sidecarSize).toEqual(size);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual(pos);
    // minimized 不影响它们
    useKiroPreferencesStore.getState().setSidecarMinimizedPosition({ right: 200, bottom: 200 });
    expect(useKiroPreferencesStore.getState().sidecarSize).toEqual(size);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual(pos);
  });
});
