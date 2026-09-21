import { z } from "zod";
import { kiroDocumentSchema } from "@/lib/ai/computer/documents/schema";
import { kiroDocumentDraftSchema } from "@/lib/ai/computer/documents/authoring/schema";
import { isStructuredBinaryPath } from "@/lib/ai/computer/filesystem/fileTypes";
import { isAllowedGuiKey } from "@/lib/ai/computer/gui/keymap";

/**
 * Computer Tool 输入 Schema（zod）——所有工具在 Executor 内强制校验。
 * 资源路径为 logical relative path；限制与 Prompt 一致。
 */

const resourcePath = z.string().trim().min(1).max(512);

export const listWorkspaceRootsSchema = z.object({});

export const listDirectorySchema = z.object({
  // allowRoot：缺省/“.” → root scope
  path: z.string().trim().max(512).optional(),
});

export const searchFilesSchema = z.object({
  query: z.string().trim().min(1).max(120),
  path: z.string().trim().max(512).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  maxDepth: z.number().int().min(1).max(10).optional(),
});

export const grepFilesSchema = z.object({
  query: z.string().trim().min(1).max(200),
  path: z.string().trim().max(512).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  maxFiles: z.number().int().min(1).max(200).optional(),
});

export const getFileMetadataSchema = z.object({
  path: resourcePath,
});

export const getDiagnosticsSchema = z.object({
  path: resourcePath,
  rootId: z.string().trim().min(1).max(120).optional(),
});

export const readTextSchema = z.object({
  path: resourcePath,
  startLine: z.number().int().min(1).max(1_000_000).optional(),
  endLine: z.number().int().min(1).max(1_000_000).optional(),
  maxChars: z.number().int().min(1).max(24000).optional(),
});

export const inspectDocumentSchema = z.object({
  path: resourcePath,
});

export const createDirectorySchema = z.object({
  path: resourcePath,
});

export const createTextFileSchema = z.object({
  path: resourcePath.refine(
    (p) => !isStructuredBinaryPath(p),
    "不能创建结构化二进制格式（DOCX/PDF/XLSX/PPTX）；Word 文档必须使用 create_document"
  ),
  content: z.string().min(0).max(120_000),
});

export const patchTextFileSchema = z.object({
  path: resourcePath.refine(
    (p) => !isStructuredBinaryPath(p),
    "不能修改结构化二进制格式（DOCX/PDF/XLSX/PPTX）；Word 文档必须使用 update_document"
  ),
  edits: z
    .array(
      z.object({
        oldText: z.string().min(1).max(40_000),
        newText: z.string().max(40_000),
      })
    )
    .min(1)
    .max(20),
});

/** V2.5+V2.8：delete_file —— 只删除单个文件（不支持目录 / 递归 / root / glob / 批量）。
 *  rootId 可选：single-root Workspace 可省略（自动解析唯一 root）；
 *  multi-root Workspace 省略 → ROOT_REQUIRED（必须使用 list_workspace_roots / list_directory 返回的 rootId）。 */
export const deleteFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120).optional(),
  path: resourcePath,
});

/** Desktop Terminal V1/V2：run_terminal_command。
 * V2 新增 executionMode（默认 foreground；long-running 必须显式使用——放宽 timeout 上限，
 * 不默认允许无限 background process）。无 env/stdin/elevation 字段。 */
export const runTerminalCommandSchema = z.object({
  shell: z.enum(["powershell", "cmd"]),
  rootId: z.string().trim().min(1).max(120).optional(),
  /** relative cwd（"" = root） */
  cwd: z.string().trim().max(512).optional(),
  // 空命令由 Risk Classifier 判为 blocked（TERMINAL_COMMAND_BLOCKED），不在 schema 层拦截
  command: z.string().max(8192),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  /** V2：executionMode = "long-running" 显式启用长任务（timeout 上限放宽至 600s）；默认 foreground */
  executionMode: z.enum(["foreground", "long-running"]).optional(),
});

/**
 * Desktop Terminal V2（Phase 3）：write_terminal_input —— 向活跃进程写 stdin。
 * - 只允许非敏感输入（y/n/数字/短文本等）；密码/API Key/Token/SSH secret 必须走
 *   UI secure-input（不经模型 context）——executor 会拒绝敏感形状数据。
 * - handle 是 opaque logical terminal handle（start_terminal_command 返回；不是原生 executionId）。
 */
export const writeTerminalInputSchema = z.object({
  handle: z.string().trim().min(1).max(64),
  data: z.string().min(1).max(4096),
});

/**
 * Desktop Terminal V2（Phase 3 async）：start_terminal_command —— 异步启动交互式命令，立即返回 handle。
 * 与 run_terminal_command 共享完全相同的 safety pipeline（workspace gate / Native root / policy / Risk / approval）。
 */
export const startTerminalCommandSchema = z.object({
  shell: z.enum(["powershell", "cmd"]),
  rootId: z.string().trim().min(1).max(120).optional(),
  cwd: z.string().trim().max(512).optional(),
  command: z.string().max(8192),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  executionMode: z.enum(["foreground", "long-running"]).optional(),
});

/** wait_terminal_command —— 等待指定 handle 的最终结果（仅 opaque handle，不接受 executionId） */
export const waitTerminalCommandSchema = z.object({
  handle: z.string().trim().min(1).max(64),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

/** PTY Session V2（Phase 4 Agent）：create_terminal_session */
export const createTerminalSessionSchema = z.object({
  shell: z.enum(["powershell", "cmd"]),
  rootId: z.string().trim().min(1).max(120).optional(),
  cwd: z.string().trim().max(512).optional(),
});

/** PTY Session V2：run_terminal_session_command —— 在持久 PTY 中运行单条命令（per-command Risk Gate） */
export const runTerminalSessionCommandSchema = z.object({
  sessionHandle: z.string().trim().min(1).max(64),
  command: z.string().max(8192),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

/** PTY Session V2：write_terminal_session_input —— 向 PTY 中等待输入的命令写入非敏感输入 */
export const writeTerminalSessionInputSchema = z.object({
  sessionHandle: z.string().trim().min(1).max(64),
  data: z.string().min(1).max(4096),
});

/** PTY Session V2：close_terminal_session */
export const closeTerminalSessionSchema = z.object({
  sessionHandle: z.string().trim().min(1).max(64),
});
/** V2.3：Model-facing schemas 按 Document Authoring Protocol Version 分离。
 *  - V1 model contract：Canonical KiroDocument（legacy Client）
 *  - V2 model contract：扁平 Draft（当前 Client）
 *  Browser Runtime 不使用其中任何一个作为唯一 Schema（用 z.unknown() + parseDocumentAuthoringInput 双兼容）。
 */

export const createDocumentV1ModelSchema = z.object({
  path: resourcePath,
  document: kiroDocumentSchema,
});

export const createDocumentV2ModelSchema = z.object({
  path: resourcePath,
  document: kiroDocumentDraftSchema,
});

export const updateDocumentV1ModelSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: kiroDocumentSchema,
});

export const updateDocumentV2ModelSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: kiroDocumentDraftSchema,
});

/** Browser Runtime top-level schema：document 为 z.unknown()——不是放宽安全边界，
 *  document 必须在 Executor IO 前进入 parseDocumentAuthoringInput() 完成严格双兼容校验。 */
export const createDocumentRuntimeSchema = z.object({
  path: resourcePath,
  document: z.unknown(),
});

export const updateDocumentRuntimeSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: z.unknown(),
});

/** 兼容别名（旧 import 使用 createDocumentSchema / updateDocumentSchema = runtime schema） */
export const createDocumentSchema = createDocumentRuntimeSchema;
export const updateDocumentSchema = updateDocumentRuntimeSchema;

/** V2：rename_file —— newName 只能是 basename（/ \\ . .. NUL/control/Windows reserved 由运行时拒绝） */
export const renameFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: resourcePath,
  newName: z.string().trim().min(1).max(255),
});

/** V2：move_file —— 同一 frozen Workspace 内跨 root 移动；目标不存在（无隐式覆盖） */
export const moveFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: resourcePath,
  destinationRootId: z.string().trim().min(1).max(120),
  destinationPath: resourcePath,
});

/** V3 Part 1：search_workspace_knowledge —— 本地知识索引候选搜索（正文结论仍需实时读取） */
export const searchWorkspaceKnowledgeSchema = z.object({
  query: z.string().trim().min(1).max(200),
  rootIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

/** V3 Part 2：retrieve_workspace_context —— Grounded Retrieval（live excerpt；有界 budget） */
export const retrieveWorkspaceContextSchema = z.object({
  query: z.string().trim().min(1).max(200),
  rootIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32).optional(),
  maxFiles: z.number().int().min(1).max(4).optional(),
  maxChars: z.number().int().min(1).max(6000).optional(),
});

/**
 * Computer Use Phase 1：observe_desktop —— 只读桌面观察（截图 + UI Automation 控件树）。
 * - windowId 只能是 Runtime 返回的 opaque logical id（win-…）；绝不接受 HWND/PID/路径。
 * - 本阶段不存在任何点击/键盘/输入能力（Observe only）。
 */
export const observeDesktopSchema = z
  .object({
    target: z.enum(["active-window", "screen"]).optional(),
    windowId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^win-[A-Za-z0-9]+$/, "windowId 必须是 observe_desktop 返回的逻辑窗口 id（win-…）")
      .optional(),
    includeScreenshot: z.boolean().optional(),
    includeUiTree: z.boolean().optional(),
    /** Phase 3：UI Automation 无法定位时启用视觉候选区域（只生成 Observation candidate） */
    includeVision: z.boolean().optional(),
    visionGoal: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * Computer Use Phase 3：list_desktop_windows / activate_window / open_application。
 * - 所有 windowId 都是 session-local opaque id（win-…）
 * - open_application 只接受 logical app id（绝不接受 exe / 绝对路径）
 */
export const listDesktopWindowsSchema = z.object({}).strict();

export const activateWindowSchema = z
  .object({
    windowId: z
      .string()
      .trim()
      .regex(/^win-[A-Za-z0-9]+$/, "windowId 必须是 list_desktop_windows / observe_desktop 返回的逻辑窗口 id"),
  })
  .strict();

export const openApplicationSchema = z
  .object({
    app: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(
        (value) => !/[\\/:]/.test(value) && !/\.exe$/i.test(value),
        "只能使用逻辑应用名（例如 chrome / word / wechat），不要使用 exe 或文件路径"
      ),
  })
  .strict();

/**
 * Computer Use Phase 2：desktop_action —— 在明确授权下操作 GUI（Observe → Action → Observe）。
 * - 具备 target 的动作必须携带最近一次 observationId（观察强绑定；失效 → STALE_OBSERVATION）
 * - target 优先 elementId；坐标仅允许 normalized 0~1（禁止物理像素）
 * - 密码 / API Key / Token / Secret 等敏感信息绝不允许经 tool input
 */
export const desktopActionSchema = z
  .object({
    action: z.enum(["click", "double_click", "focus", "type", "key", "scroll", "wait"]),
    observationId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^obs-[A-Za-z0-9-]+$/, "observationId 必须是 observe_desktop 返回的观察 id")
      .optional(),
    target: z
      .object({
        elementId: z.string().trim().regex(/^el-\d{1,4}$/, "elementId 必须是观察结果中的元素 id").optional(),
        normalized: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    text: z.string().min(1).max(2000).optional(),
    key: z.string().trim().min(1).max(32).optional(),
    scroll: z.number().int().min(-10).max(10).refine((v) => v !== 0, "scroll 不能为 0").optional(),
    wait: z.number().int().min(100).max(5000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (value.action !== "wait" && !value.observationId) {
      issue(["observationId"], "该动作必须先 observe_desktop 并提供 observationId");
    }
    const hasElement = value.target?.elementId !== undefined;
    const hasNormalized = value.target?.normalized !== undefined;
    if (value.target && hasElement === hasNormalized) {
      issue(["target"], "target 必须且只能提供 elementId 或 normalized 之一");
    }
    const requiresTarget = ["click", "double_click", "focus"].includes(value.action);
    if (requiresTarget && !value.target) {
      issue(["target"], "该动作必须提供 target（elementId 优先）");
    }
    if (value.action === "focus" && hasNormalized) {
      issue(["target"], "focus 只能使用 elementId");
    }
    if (value.action === "type") {
      if (!value.text) issue(["text"], "type 动作必须提供 text");
      if (value.key !== undefined || value.scroll !== undefined || value.wait !== undefined) {
        issue([], "type 动作不允许携带 key / scroll / wait");
      }
    }
    if (value.action === "key") {
      if (!value.key) issue(["key"], "key 动作必须提供 key");
      else if (!isAllowedGuiKey(value.key)) issue(["key"], "按键不在允许列表内（不支持 clipboard / 系统级组合键）");
    }
    if (value.action === "scroll" && value.scroll === undefined) {
      issue(["scroll"], "scroll 动作必须提供 scroll");
    }
    if (value.action === "wait" && value.wait === undefined) {
      issue(["wait"], "wait 动作必须提供 wait（毫秒）");
    }
    if (["click", "double_click", "focus"].includes(value.action)) {
      if (value.text !== undefined || value.key !== undefined || value.scroll !== undefined || value.wait !== undefined) {
        issue([], `${value.action} 动作不允许携带 text / key / scroll / wait`);
      }
    }
  });
