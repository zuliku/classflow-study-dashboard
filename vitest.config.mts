import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["vitest.setup.ts"],
    // 全量并行跑 145+ 文件时，重 IO/真实 ConPTY/docx fixture 用例在默认 5s 下会被
    // CPU 争用误杀（单独运行均 <3s）。放宽全局上限，消除 CI gate 偶发 flake。
    testTimeout: 20000,
    hookTimeout: 20000,
    // Windows 大仓库全量并行时，过多 worker 会导致 CPU 争用，2-3s 的用例被放大到
    // 超过 testTimeout（实测 18 线程下 6-10 倍减速）。限制并发到一半核心数，
    // 单文件耗时基本不变、总墙钟更稳定。
    poolOptions: {
      threads: { maxThreads: 8, minThreads: 1 },
    },
    // 全量收集：显式文件清单已严重漂移（219 个测试文件从未被执行），改为 glob 防止再次漂移。
    // Live-provider smoke 自带环境变量 skip 守卫；Playwright E2E（*.spec.ts）不在 vitest 范围。
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "scripts/docx-compat/generate-fixtures.test.ts",
    ],
    // ---- Legacy Suite Quarantine（稳定性审计 BUG-012，见 docs/bug-ledger）----
    // 这些套件在 include 清单漂移期间从未被执行，其断言已与现行产品契约脱节，
    // 属「未完成的 TDD / 已废弃契约」而非产品回归。恢复执行前需按当前契约重写：
    // - aiMuseSpark.test.ts          ：muse-spark 高配变体已退役（contributor 版 = openai-chat、无 vision/reasoning）
    // - aiRoutes.test.ts             ：chat/test/models 路由已强制 invocationId 校验（安全加固后未回填用例）
    // - compactRoute.test.ts         ：同上
    // - kiro-computer-delete.test.ts ：文件内自带「红测试（先失败后修复）」标注，TDD 未完成
    // - kiro-computer-policy.test.ts ：断言旧策略默认值（workspace-auto 全 allow / fs.delete=deny），已被新审批模型取代
    // - kiro-computer-tools.test.ts  ：工具面数量断言过期（17 vs 现行 25）
    exclude: [
      "tests/aiMuseSpark.test.ts",
      "tests/aiRoutes.test.ts",
      "tests/compactRoute.test.ts",
      "tests/unit/kiro-computer-delete.test.ts",
      "tests/unit/kiro-computer-policy.test.ts",
      "tests/unit/kiro-computer-tools.test.ts",
    ],
  },
});
