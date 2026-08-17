import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const alias = {
  "@": resolve(__dirname, "."),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        // 主进程只 import route 文件，无需额外 entry
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    // 原 Next 项目的 public/ 静态资源（logo、kiro 图标、模型图标等）原样进构建
    publicDir: resolve(__dirname, "public"),
    define: {
      // 与 next.config.mjs 的 NEXT_PUBLIC_APP_VERSION 同源：构建时注入 package.json 版本
      "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(pkg.version),
      // dev-only 节流参数（原 Next 部署由运行时 env 注入；桌面版无此 env → undefined 走默认值）
      "process.env.NEXT_PUBLIC_KIRO_CLIENT_THROTTLE_MS": JSON.stringify(undefined),
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
