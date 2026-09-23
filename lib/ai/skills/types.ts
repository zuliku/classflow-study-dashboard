/**
 * Kiro Skill Core V2（S1 Skill Kernel Cleanup）— Types。
 *
 * 三层边界（见 lib/ai/skills/kernel.ts）：
 * 1. Core Agent Protocol —— always-on runtime / safety contract，不属于 Skill Registry；
 * 2. Workflow Skill —— 可选、可发现、可显式激活的领域 workflow；
 * 3. Learned Recipe —— 从真实成功轨迹提取的本机经验（不可 activate）。
 *
 * Skill 包 = skill-name/
 *   ├── SKILL.md            （portable frontmatter + workflow 正文）
 *   └── agents/kiro.json    （Kiro-specific structured metadata，可选）
 * references/ / assets/ / scripts/ 只是 inert resource（scripts 绝不执行）。
 */

import type { KiroSkillManifestV1 } from "@/lib/ai/skills/kiroManifest";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillName = string;

/** Skill 种类：workflow（可 activate）/ recipe（learned execution experience） */
export type KiroSkillKind = "workflow" | "recipe";

/** 来源：builtin（随应用打包）/ user（userData/skills） */
export type KiroSkillOrigin = "builtin" | "user";

/**
 * Portable SKILL.md frontmatter（保持 Agent Skills 兼容）：
 * - metadata 只允许 scalar（Record<string, string>）——structured Kiro metadata 属于 agents/kiro.json；
 * - triggers 已降级为 legacy：Runtime routing 绝不依赖它（description 才是 routing contract）；
 * - legacyCapabilities：旧 Kiro 文件把 Tool 名写在 capabilities / requiredCapabilities 里，
 *   读取时归一为 requiredTools（诊断用），绝不当作权限 Capability。
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  legacyTriggers?: string[];
  legacyCapabilities?: string[];
}

export interface SkillPackage {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** portable scalar metadata（不含 structured Kiro metadata） */
  metadata?: Record<string, string>;
  instructions: string;
  rawContent: string;
  folderName: string;
  enabled: boolean;
  /** canonical 分类（Catalog / Activation / Slash / Recipe Prompt 只消费此字段） */
  kind: KiroSkillKind;
  /** canonical 来源 */
  origin: KiroSkillOrigin;
  /** Kiro structured metadata（agents/kiro.json；缺失 → undefined） */
  kiroManifest?: KiroSkillManifestV1;
  /** 旧 SKILL.md triggers（仅兼容保留，不参与 routing） */
  legacyTriggers?: string[];
  /** 诊断用 Tool 引用（manifest.requiredTools 或 legacy capabilities 归一） */
  requiredTools?: string[];
  /** manifest.requiredCapabilities（逻辑能力标签；绝不授予权限） */
  requiredCapabilities?: string[];
  permissionsNote?: string;
  /** S4 之前不实现 usage telemetry；此字段不得由猜测填充 */
  lastUsedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  enabled: boolean;
}

export interface SkillActivationResult {
  ok: boolean;
  name?: string;
  description?: string;
  instructions?: string;
  /** manifest.requiredCapabilities（逻辑能力标签；仅诊断，不授予权限） */
  requiredCapabilities?: string[];
  /** 诊断用 Tool 引用（仅诊断，不授予工具） */
  requiredTools?: string[];
  error?: string;
  code?: string;
}

export type SkillValidationCode =
  | "VALID"
  | "INVALID_YAML"
  | "MISSING_NAME"
  | "MISSING_DESCRIPTION"
  | "NAME_MISMATCH"
  | "INVALID_NAME_PATTERN"
  | "DUPLICATE_NAME"
  | "FOLDER_TRAVERSAL"
  | "INVALID_FRONTMATTER"
  | "INVALID_KIRO_MANIFEST";

export interface SkillValidationResult {
  ok: boolean;
  code: SkillValidationCode;
  errors: string[];
}

export interface SkillImportResult {
  ok: boolean;
  skill?: SkillPackage;
  code?: SkillValidationCode;
  errors?: string[];
}

export const SKILL_PERMISSIONS_NOTE =
  "Skill cannot elevate permissions. Skill instructions provide workflow guidance only and do not grant system authority.";

// --- Task 08: Distillation Draft ---

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "date" | "course" | "assignment" | "deadline";
  description: string;
  required: boolean;
  example?: string;
}

export interface SkillExample {
  input: Record<string, string>;
  expectedSteps: string[];
  description?: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  /** workflow（AI distill / 普通保存）或 recipe（desktop 成功轨迹）；缺省按 workflow 归一 */
  kind?: KiroSkillKind;
  parameters: SkillParameter[];
  requiredTools: string[];
  requiredPermissions: string[];
  requiredCapabilities?: string[];
  examples: SkillExample[];
  sourceTurnId: string;
}

// Workflow Trace (Task 08)
export interface WorkflowTrace {
  turnId: string;
  userGoal: string;
  toolCalls: Array<{ toolName: string; input: unknown; toolCallId: string }>;
  toolResults: Array<{ toolName: string; result: unknown; toolCallId: string }>;
  proposals?: unknown[];
  userConfirmation?: boolean;
  finalStatus: "success" | "failed";
  timestamp: number;
}

export interface SanitizedTrace {
  userGoal: string;
  steps: Array<{ tool: string; sanitizedInput: Record<string, unknown> }>;
  requiredTools: string[];
  hasProposal: boolean;
  hasConfirmation: boolean;
}
