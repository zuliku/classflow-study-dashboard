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
};

export default nextConfig;
