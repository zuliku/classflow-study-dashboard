import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Task 06 — Local HTTP API 安全边界", () => {
  const serverPath = path.join(process.cwd(), "src/main/httpServer.ts");
  const preloadPath = path.join(process.cwd(), "src/preload/index.ts");
  const configPath = path.join(process.cwd(), "lib/security/electronConfig.ts");

  it("本地 API Server 不再使用 Access-Control-Allow-Origin: *", () => {
    const src = fs.readFileSync(serverPath, "utf-8");
    expect(src).not.toContain('"access-control-allow-origin": "*"');
    expect(src).not.toContain("access-control-allow-origin\", \"*\"");
  });

  it("本地 API Server 校验 Origin（app://bundle / dev origin 白名单）", () => {
    const src = fs.readFileSync(serverPath, "utf-8");
    expect(src).toContain("isTrustedOrigin");
    expect(src).toContain("app://bundle");
    expect(src).toContain("ELECTRON_RENDERER_URL");
    expect(src).toContain("403");
  });

  it("本地 API Server 校验 per-launch capability token（缺失/错误 → 401）", () => {
    const src = fs.readFileSync(serverPath, "utf-8");
    expect(src).toContain("x-classflow-capability");
    expect(src).toContain("randomUUID");
    expect(src).toContain("401");
  });

  it("capability 保存在 preload closure，通过统一 api.request 自动附加", () => {
    const src = fs.readFileSync(preloadPath, "utf-8");
    expect(src).toContain("resolveApiCapability");
    expect(src).toContain("--classflow-api-capability=");
    expect(src).toContain("x-classflow-capability");
    expect(src).toContain("api: {");
    expect(src).toContain("request:");
  });

  it("Preload credentials bridge 只暴露 create/replace/delete/list", () => {
    const src = fs.readFileSync(preloadPath, "utf-8");
    expect(src).toContain("credentialsBridge");
    expect(src).toContain("bridge:credential:create");
    expect(src).toContain("bridge:credential:replace");
    expect(src).toContain("bridge:credential:delete");
    expect(src).toContain("bridge:credential:list");
    expect(src).not.toContain("bridge:credential:resolve");
    expect(src).not.toContain("getSecret");
    expect(src).not.toContain("readPlaintext");
    expect(src).not.toContain("exportSecret");
  });

  it("electronConfig builder 注入 capability additionalArgument", () => {
    const src = fs.readFileSync(configPath, "utf-8");
    expect(src).toContain("apiCapability");
    expect(src).toContain("--classflow-api-capability=");
  });

  it("Secret IPC 注册使用 sender validation（通道在 ipcSender 标记敏感）", () => {
    const ipcSrc = fs.readFileSync(path.join(process.cwd(), "src/main/secrets/secretIpc.ts"), "utf-8");
    expect(ipcSrc).toContain("bridge:credential:create");
    expect(ipcSrc).toContain("validateSender");
    expect(ipcSrc).toContain("PERMISSION_DENIED");
    const senderSrc = fs.readFileSync(path.join(process.cwd(), "lib/security/ipcSender.ts"), "utf-8");
    expect(senderSrc).toContain("bridge:credential:");
  });

  it("Main 注册 Secret IPC（index.ts 消费 registerSecretIpc）", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(src).toContain("registerSecretIpc");
    expect(src).toContain("apiCapability");
  });
});
