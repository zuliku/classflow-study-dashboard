// vitest 环境为 Node：为 zustand persist（createJSONStorage(() => localStorage)）
// 提供最小内存版 localStorage polyfill，保证 store 模块可被安全导入。
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// 同理由：Kiro API Key 会话存储（sessionStorage）也需要最小内存 polyfill
if (typeof globalThis.sessionStorage === "undefined") {
  const sessionStore = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key)! : null),
    setItem: (key, value) => {
      sessionStore.set(key, String(value));
    },
    removeItem: (key) => {
      sessionStore.delete(key);
    },
    clear: () => {
      sessionStore.clear();
    },
    key: (index) => Array.from(sessionStore.keys())[index] ?? null,
    get length() {
      return sessionStore.size;
    },
  } as Storage;
}
