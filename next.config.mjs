import { createRequire } from "module";

/** @type {import('next').NextConfig} */
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig = {
  reactStrictMode: true,
  // build-time 注入唯一版本来源：UI（About）与 package.json 保持一致，禁止 JSX 手写版本号
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // Task 19C2：@napi-rs/canvas 是 Node 原生模块（skia .node 二进制），
  // 只允许 Server runtime 使用；必须 external，禁止打进任何 bundle（含 server bundle）。
  // Next 14：experimental.serverComponentsExternalPackages（15 起改名 serverExternalPackages）
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
  },
};

export default nextConfig;
