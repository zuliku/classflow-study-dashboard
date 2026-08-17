# ClassFlow Desktop Filesystem Bridge — Contract V1

本文档定义未来 Desktop Runtime 注入 Web 应用的唯一 Native Filesystem 契约。
Web 侧实现位于 `lib/desktop/`（types + bridge）+ `lib/ai/computer/adapters/native.ts`；
Desktop Runtime **不需要修改 Kiro Computer Domain**——只需实现本契约中的
`window.classflowDesktop`，Native Adapter 即可自动工作。

---

## 1. Bridge Version

- 第一版固定：`version: 1`。
- 不使用 `"latest"` / 范围匹配；Web 与 Runtime 通过**精确版本协商**。
- Web 只接受 `version === 1`；未知版本一律视为 **unavailable**（不做猜测兼容）。

## 2. Window Injection Shape

Desktop Runtime 必须注入：

```ts
window.classflowDesktop = {
  version: 1,
  platform: "windows" | "macos" | "linux" | "unknown",
  filesystem: { /* 见 §5 */ },
};
```

- Web 侧唯一访问入口是 `lib/desktop/bridge.ts`（`getClassFlowDesktopBridge()`）。
- 每次 IO 前 Web 都会重新 resolve（不缓存）——Runtime 可随时卸载 / 重启 / 权限丢失。

## 3. grantId Semantics

- `pickDirectory()` 返回 **opaque grantId**（如 `grant_abc`），Web 永远不知道其背后的真实路径。
- grantId 字符集：`[A-Za-z0-9_-]`，1–128 chars。Web 侧 `isValidNativeGrantId()` 严格校验，
  非法即拒绝创建 Workspace。
- Runtime 内部可维护 `grantId → absolute path` 映射；**禁止**把映射右侧暴露给 renderer。

## 4. Relative Path Only

所有 filesystem 方法只接受 `grantId + relativePath`：

```ts
readText({ grantId: "grant_abc", path: "论文/outline.md" })
```

**禁止**：
- `C:\Users\...` / `/root/...` / `\\server\share\...` 等 absolute path
- `..` 逃逸（Web resolver 已拒绝；Runtime 必须再次验证，见 §8）

## 5. Required Methods（V1）

```ts
interface ClassFlowDesktopFilesystemBridgeV1 {
  pickDirectory(input: { access: "read-only" | "read-write" }):
    Promise<{ grantId: string; displayName: string; access: "read-only" | "read-write" } | null>;
  getGrantStatus(input: { grantId: string }):
    Promise<{ status: "granted" | "missing" | "denied" }>;
  forgetGrant(input: { grantId: string }): Promise<void>;

  list(input: { grantId: string; path: string }):
    Promise<Array<{ name: string; kind: "file" | "directory"; size: number }>>;
  stat(input: { grantId: string; path: string }):
    Promise<{ kind: "file" | "directory"; size: number; type?: string } | null>;
  readText(input: { grantId: string; path: string }): Promise<string>;
  readBytes(input: { grantId: string; path: string }): Promise<Uint8Array>;
  readTextPrefix(input: { grantId: string; path: string; maxBytes: number }):
    Promise<{ text: string; truncated: boolean }>;
  createDirectory(input: { grantId: string; path: string }): Promise<"created" | "exists">;
  writeText(input: { grantId: string; path: string; content: string; type?: string }): Promise<void>;
  writeBytes(input: { grantId: string; path: string; content: Uint8Array; type?: string }): Promise<void>;
  remove(input: { grantId: string; path: string; kind: "file" | "directory" }): Promise<void>;
  move(input: { grantId: string; from: string; to: string }): Promise<void>;
}
```

## 6. Method Result Schemas

- `list`：直接子项（非递归）；目录在前、名称 locale 排序由 Web 侧执行（Runtime 无需排序）。
- `stat`：不存在 → `null`；存在 → kind/size/type。
- `readTextPrefix`：**按 byte prefix 读取**，绝不先读全文再截断（KIRO.md 等 bounded 读取依赖它）。
- `createDirectory`：已存在 → `"exists"`（不报错）。
- `move`：file-only relocation（源必须存在、目标必须不存在；实现必须保证
  source absent + target present，失败时尽力回滚到一致状态）。

## 7. Error Schemas

禁止向 Web throw raw OS error / `EPERM` / `ENOENT` / stack / absolute path。
必须返回结构化错误（reject with）：

```ts
{
  code: "NOT_FOUND" | "ALREADY_EXISTS" | "PERMISSION_DENIED" |
        "DIRECTORY_NOT_EMPTY" | "INVALID_OPERATION" | "IO_ERROR";
  message?: string; // 用户可读短说明；禁止包含 native path
}
```

Web 侧映射（`adapters/native.ts` → `mapBridgeError`）：

| Bridge code            | ComputerErrorCode          |
| ---------------------- | -------------------------- |
| NOT_FOUND              | RESOURCE_NOT_FOUND         |
| ALREADY_EXISTS         | RESOURCE_ALREADY_EXISTS    |
| PERMISSION_DENIED      | PERMISSION_DENIED          |
| DIRECTORY_NOT_EMPTY    | VERIFICATION_FAILED        |
| INVALID_OPERATION      | INVALID_INPUT              |
| IO_ERROR               | 按操作 fallback            |

非结构化异常（违反契约）同样被归一化——**绝不把 Runtime 内部异常传给模型**。

## 8. Sandbox Boundary — Runtime MUST

Web 已执行 `normalizeRelativeComputerPath()`（第一边界），但 **Runtime 不得依赖 Web 作为唯一边界**：

- MUST：`resolve(root, relativePath)` → canonicalize → 验证 target 仍是 granted root 的 descendant。
- MUST：拒绝 `..` / absolute path / UNC / symlink 逃逸。
- MUST：**junction / symlink / reparse point 不得逃逸 granted root**
  （Windows 迁移尤其注意；Runtime 必须在每次 IO 解析后验证 canonical 位置）。
- MUST：每次操作都验证 grant 仍然有效（granted）。
- MUST：`grantId` 视为 opaque capability；绝不接受 renderer 传来的 raw absolute path。
- MUST NOT：暴露任意 fs API / shell / network / app launch。
- MUST NOT：在错误信息中返回完整 native path。

## 9. Grant Lifecycle

- `pickDirectory` 只能由**用户主动手势**触发（Web 侧 Settings「添加本地文件夹」）。
- `getGrantStatus`：`granted / missing / denied`（Web 映射 missing/denied → 现有
  `WORKSPACE_PERMISSION_REQUIRED` / `PERMISSION_DENIED`；不伪装成文件不存在）。
- `forgetGrant`：删除授权映射；**绝不删除真实目录内容**。
- 重新授权不假设选择同一个路径：新 grant 在新选择完成后替换旧 adapterRef。

## 10. No Absolute Path to Renderer / Model

- renderer / model / server / persisted store 只出现：`native:<grantId>`（adapterRef，runtime-only）、
  workspaceId、rootId、label、access、relative path。
- `KiroComputerTurnSnapshot` 只含 workspaceId/rootId/label/access —— 不含 adapterRef/grantId/platform/absolutePath。

## 11. Atomicity Expectations

- `writeText / writeBytes`：单文件写入应原子（write-temp-rename 或等价），失败不留半文件。
- `move`：源删除 + 目标落位必须一致（失败回滚）。
- Web 侧 Undo 通过 checkpoint 逆操作（`checkpoints.ts`）调用 `remove / write / move`——
  Runtime 按契约语义实现即可自动兼容（**不要为 Native 建第二套 Undo**）。

## 12. Remove Semantics

- `remove({ kind: "file" })`：删除文件。
- `remove({ kind: "directory" })`：**non-recursive**；非空 → `DIRECTORY_NOT_EMPTY`（Undo 失败路径）。

## 13. Move Semantics

- 仅 file；同 grant 内。
- 目标已存在 → `ALREADY_EXISTS`。
- 成功后必须保证：source absent、target present（Web 校验 `VERIFICATION_FAILED`）。

## 14. Byte Payload Semantics

- `Uint8Array`（structured-clone friendly）用于 binary（如 DOCX 渲染产物）。
- DOCX rendering 永远在 Web 侧完成（`documents/`）；Runtime **不处理**文档渲染，只写 bytes。

## 15. Security MUST / MUST NOT（摘要）

| MUST                                                       | MUST NOT                                    |
| ---------------------------------------------------------- | ------------------------------------------- |
| grantId 视为 opaque capability                             | 接受 renderer 的 raw absolute path          |
| 每次操作 canonicalize + 验证 root 内                        | 允许 symlink / junction 逃逸                |
| 每次操作验证 grant 有效                                    | 暴露 shell / network / app launch           |
| 结构化错误（无 stack / 无 path）                            | 在错误中返回完整 native path                |
| 忘记授权只删映射                                           | 删除用户真实目录内容                        |

---

## Desktop Runtime 迁移清单（给未来 Desktop Agent）

1. 实现 `window.classflowDesktop`（`version: 1` + `filesystem` 全方法）。
2. 维护 `grantId → absolute path` 映射（renderer 不可见）。
3. 完成 §8 的所有 Runtime MUST（尤其 junction/symlink 逃逸防护）。
4. **不要修改**：Kiro Computer Tool schema / Agent 权限模型 / policy / snapshot / artifact /
   knowledge / audit —— 全部由 Web 侧 Native Adapter 自动复用。

验证入口：Web 仓库 `tests/e2e/kiro-computer-native-v1.spec.ts`（memory bridge 全链路）。

---

# 冻结状态（FROZEN FOR DESKTOP HANDOFF）

**Contract status: FROZEN FOR DESKTOP HANDOFF**

Web contract（版本保持 1 / V1 / V1，本轮只做 clarification + hardening，不做 version bump）：
- Desktop Bridge V1（`version: 1`）
- Filesystem Bridge V1
- Terminal Bridge V1

冻结含义：Desktop Runtime 实现者**不应修改** Kiro Tool schemas / Computer policy /
Agent mode semantics / Approval semantics / workspace metadata shape。
Desktop Runtime 只实现 `window.classflowDesktop`。

冻结不代表永远不升级：未来如需 PTY / interactive stdin / WSL / shell streaming /
OS-level process sandbox / admin actions / app.open / app.reveal，必须通过**新的 optional
capability** 或**明确版本升级**引入；不得偷偷修改 V1 semantics。

## Desktop Handoff Checklist（Desktop Agent 只需完成以下）

**FILESYSTEM**：pickDirectory / getGrantStatus / forgetGrant / list / stat / readText /
readBytes / readTextPrefix / createDirectory / writeText / writeBytes / remove / move。

**TERMINAL**：execute / cancel。

并满足：grant opaque、relative path only、canonical sandbox、symlink/junction/reparse 防护、
原子文件写入、non-interactive shell、no elevation、process-tree timeout、process-tree cancel、
bounded stdout/stderr、结构化错误、无 absolute path 泄漏。

## Terminal Error Contract（交接表；TS 与本文档必须一致）

| Situation                        | Runtime behavior                             |
| -------------------------------- | -------------------------------------------- |
| exit 0                           | resolve `exitCode=0`                         |
| exit nonzero                     | resolve `exitCode=N`                         |
| timeout                          | resolve `timedOut=true` / `exitCode=null`     |
| user cancel（Stop）              | **reject** `{ code: "CANCELLED" }`            |
| permission / grant failure       | **reject** `{ code: "PERMISSION_DENIED" }`    |
| runner infrastructure failure    | **reject** `{ code: "EXECUTION_FAILED" }`     |
| invalid bridge operation         | **reject** `{ code: "INVALID_OPERATION" }`    |

- **timeout 永不 reject**（属于 process execution outcome；`DesktopTerminalBridgeErrorCode`
  不包含 TIMEOUT）。
- **cancel 永不 resolve** `exitCode=null` 表达（必须 reject CANCELLED）。
- `EXECUTION_FAILED` 只表示 runner 无法启动/管理（如 PowerShell 可执行文件缺失）；
  command 本身 exitCode=1 是正常 resolve。
- 错误对象绝不包含 absolute path / username / stack / raw OS error。

Desktop Runtime 行为示意（pseudo-code；不要实现真实 Node/Electron 代码）：

```text
execute({ executionId, shell, grantId, cwd, command, timeoutMs }):
  validate grant(grantId)            # 否则 reject PERMISSION_DENIED
  resolveAndCanonicalize(root, cwd)  # 否则 reject PERMISSION_DENIED / INVALID_OPERATION
  try:
    process = spawn(shell, non-interactive, cwd=resolvedCwd, no elevation)
    result = runBounded(process, timeoutMs)      # stdout/stderr bounded
    if result.timeout:
      killTree(process)
      return { exitCode: null, timedOut: true, stdout, stderr, durationMs, ... }
    return { exitCode: process.exitCode, timedOut: false, ... }
  catch infrastructureError:        # spawn 失败 / 运行时基础设施故障
    throw { code: "EXECUTION_FAILED" }

cancel(executionId):
  killTree(executionId)              # 终止整个 process tree
  execute promise rejects { code: "CANCELLED" }
```

---

# Terminal Bridge V1（Optional Capability）

## 1. 架构边界：Filesystem Sandbox ≠ Process Sandbox

- **Filesystem Adapter**：ClassFlow 能严格约束 `root + relative path`（resolver + bridge 双边界）。
- **Terminal**：虽然 `cwd` 在 Workspace 内，命令本身理论上可能访问系统其它位置——
  Terminal 是 **Privileged Desktop Capability**。
- **UI/文档绝不声称「终端只能访问这个文件夹」**；除非未来 Desktop Runtime 实现 OS 级 process isolation。

## 2. Injection

```ts
window.classflowDesktop = {
  version: 1,
  platform: "windows",
  filesystem: { /* V1 保持 */ },
  terminal?: {
    version: 1,
    execute(input): Promise<{ exitCode, stdout, stderr, timedOut, durationMs, stdoutTruncated, stderrTruncated }>,
    cancel(input): Promise<void>,
  },
};
```

- `terminal` 是 **optional**：filesystem-only Desktop Runtime 依旧 valid（Files ✓ / Terminal ❌）。
- Terminal 自己拥有 `version: 1`；`CLASSFLOW_DESKTOP_BRIDGE_VERSION` 保持 1。

## 3. execute / cancel Contract

```ts
execute({ executionId, shell: "powershell" | "cmd", grantId, cwd, command, timeoutMs })
cancel({ executionId })
```

- `executionId`：Web 生成（opaque；cancel 用）。
- `cwd`：**relative only**（"" = root）；Runtime 负责 `grantId → native root` → `root + cwd`。
- `command`：1–8192 chars；`timeoutMs`：1000–120000（Web 已 clamp；Runtime 必须 enforce）。

## 4. Desktop Runtime MUST（Terminal）

- 每次执行验证 grant 仍 granted；`cwd` canonicalize 后必须位于 granted root（拒绝 escape / symlink / junction）。
- `process working directory = resolved cwd`。
- **cancel / timeout 必须终止整个 process tree**（不是只 kill powershell.exe / cmd.exe；
  node/npm/python 等子进程也必须终止）。
- stdout/stderr **bounded**（Runtime 先 bound；Web 再执行第二层 bound + ANSI strip）。
- 返回 `timedOut` 明确事实；绝不返回 PID / absolute path / environment。
- non-interactive（PowerShell 推荐 `-NoLogo -NoProfile -NonInteractive`；CMD 推荐 `/d /s /c`）。
- 不 elevation、不管理员、不开 shell window、不以后台 detached 方式运行。
- 结构化 reject 仅限 `PERMISSION_DENIED / CANCELLED / EXECUTION_FAILED / INVALID_OPERATION`
  （timeout 是 resolve 结果，不是 reject——见上方交接表），
  错误中绝不包含 absolute path / username / stack。

## 5. Web 侧行为（无需 Runtime 参与）

- `run_terminal_command`（唯一 terminal 工具；无 run_powershell/run_cmd）：
  仅在 `terminalEnabled + bridge 可用 + native root` 同时满足时暴露给模型（server tool list 条件过滤）。
- Policy：Plan deny / Guided ask / Workspace Auto normal allow。
- Terminal Risk Gate（runtime 判定）：destructive/privileged → ask；blocked（EncodedCommand/runas/
  Start-Process -Verb RunAs/空命令）→ deny。
- Approval：只提供 deny / allow-once；fingerprint = shell/rootId/cwd/command 精确绑定。
- Stop Kiro → `cancel(executionId)`（每个活跃 execution 一次）。
- 结构化 `delete_file` 在 Workspace Auto 也要求确认（与终端删除类命令一致）。

