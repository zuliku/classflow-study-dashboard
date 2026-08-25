import "fake-indexeddb/auto";

/**
 * Node 环境下的最小 Web Storage polyfill。
 *
 * 背景：vitest 全局 environment 是 "node"，需要真实 DOM 的测试文件用
 * `// @vitest-environment jsdom` 声明。但大量业务域测试（store / persist /
 * reminder / focus 等）只用到 localStorage / sessionStorage，并不需要完整 DOM；
 * 它们历史上从未被 vitest include 清单收集（清单漂移 bug），补齐收集后会以
 * "localStorage is not defined" 崩溃。这里提供进程级内存实现，使这些纯逻辑
 * 测试无需各自声明 jsdom 即可运行（jsdom 环境下此定义不会覆盖原生对象）。
 */
if (typeof globalThis.localStorage === "undefined") {
  class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length(): number {
      return this.map.size;
    }
    key(index: number): string | null {
      return Array.from(this.map.keys())[index] ?? null;
    }
    getItem(key: string): string | null {
      return this.map.has(key) ? this.map.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.map.set(String(key), String(value));
    }
    removeItem(key: string): void {
      this.map.delete(key);
    }
    clear(): void {
      this.map.clear();
    }
  }
  (globalThis as Record<string, unknown>).localStorage = new MemoryStorage();
}
if (typeof globalThis.sessionStorage === "undefined") {
  class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length(): number {
      return this.map.size;
    }
    key(index: number): string | null {
      return Array.from(this.map.keys())[index] ?? null;
    }
    getItem(key: string): string | null {
      return this.map.has(key) ? this.map.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.map.set(String(key), String(value));
    }
    removeItem(key: string): void {
      this.map.delete(key);
    }
    clear(): void {
      this.map.clear();
    }
  }
  (globalThis as Record<string, unknown>).sessionStorage = new MemoryStorage();
}
