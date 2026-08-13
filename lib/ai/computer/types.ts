/**
 * Kiro Computer Agent V1 — Computer Runtime 类型（独立 trust domain）。
 * Model-facing 资源永远是逻辑资源（workspaceId + rootId + 相对 path），
 * 绝不使用 raw native path / FileSystemDirectoryHandle / adapterRef。
 */

export type KiroAgentMode = "plan" | "guided" | "workspace-auto";

export type ComputerPermissionEffect = "allow" | "ask" | "deny";

export type ComputerCapability =
  | "workspace.list"
  | "fs.list"
  | "fs.search"
  | "fs.read"
  | "fs.create"
  | "fs.modify"
  | "fs.move"
  | "fs.delete"
  | "document.create"
  | "document.modify"
  | "app.open"
  | "app.reveal"
  | "shell.execute"
  | "network.access";

export type ComputerRisk = "read" | "create" | "modify" | "destructive" | "execute" | "external";

export interface ComputerPermissionRule {
  id: string;
  effect: ComputerPermissionEffect;
  capability: ComputerCapability;
  workspaceId?: string;
  rootId?: string;
  /** Part 1：仅支持 exact path 与规范化后的 `prefix/**`；不引入 glob dependency */
  resourcePattern?: string;
  scope: "persistent" | "session";
}

/** Workspace root 的持久化逻辑元数据。adapterRef 是 opaque runtime reference，绝不发送给模型。 */
export interface KiroWorkspaceRootMeta {
  id: string;
  label: string;
  access: "read-only" | "read-write";
  adapterRef: string;
}

export interface KiroWorkspaceMeta {
  id: string;
  name: string;
  roots: KiroWorkspaceRootMeta[];
  instructionsFile?: "KIRO.md";
  createdAt: string;
  updatedAt: string;
}

/** Model-facing 逻辑资源（唯一允许模型使用的资源标识形式） */
export interface LogicalComputerResource {
  workspaceId: string;
  rootId: string;
  path: string;
}

export type KiroAgentModeLabels = Record<KiroAgentMode, string>;

/** Mutation 成功的运行时事实（用于 Action Card；绝不含 native path / adapterRef / content blob） */
export interface ComputerActionFact {
  tool: string;
  operation: "create" | "modify";
  resourceType: "text" | "document" | "directory";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
  verification: "passed";
}
