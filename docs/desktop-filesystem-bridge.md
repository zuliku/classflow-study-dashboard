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
