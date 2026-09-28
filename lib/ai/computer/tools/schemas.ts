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

/** plan-approve 模式：propose_execution_plan —— Plan 模式只读调研结束后提交结构化执行计划。
 * 零 IO（不触碰任何文件/应用/终端）；计划经用户批准后才可执行，执行中超计划 mutation 强制回审批。
 * 步骤数 1–20；mutation 类步骤必须带 scope 锚点（path/pathPrefix/commandPrefix/artifactId/action），
 * 否则计划被拒绝并要求修正（偏离门无法匹配无锚点步骤）。 */
export const PLAN_STEP_CAPABILITIES = [
  "fs.create",
  "fs.modify",
  "fs.move",
  "fs.delete",
  "document.create",
  "document.modify",
  "shell.execute",
  "ui.interact",
  "app.open",
  "app.activate",
] as const;

export const planStepInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(500).optional(),
  toolName: z.string().trim().min(1).max(64).optional(),
  capability: z.enum(PLAN_STEP_CAPABILITIES).optional(),
  rootId: z.string().trim().min(1).max(120).optional(),
  /** 文件/文档目标相对路径（move 步骤填源路径） */
  path: z.string().trim().min(1).max(512).optional(),
  /** 路径前缀（批量/目录级步骤） */
  pathPrefix: z.string().trim().min(1).max(512).optional(),
  /** 终端命令前缀（shell 步骤必填） */
  commandPrefix: z.string().trim().min(1).max(1024).optional(),
  /** 文档更新目标 artifact */
  artifactId: z.string().trim().min(1).max(160).optional(),
  /** desktop_action 动作名（GUI 步骤必填） */
  action: z.string().trim().min(1).max(32).optional(),
});

export const proposeExecutionPlanSchema = z.object({
  title: z.string().trim().min(1).max(80),
  goal: z.string().trim().max(500).optional(),
  steps: z.array(planStepInputSchema).min(1).max(20),
});

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
 * Computer Use V2.3：desktop_session —— 声明目标 / 计划 / 当前步骤（只存 runtime memory）。
 * 只影响本会话的 planning 元数据，不执行任何 GUI 操作。
 */
export const desktopSessionSchema = z
  .object({
    action: z.enum(["set_goal", "update_plan", "set_step", "complete_step"]),
    goal: z.string().trim().min(1).max(120).optional(),
    plan: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(8)
      .optional(),
    stepIndex: z.number().int().min(0).max(7).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (value.action === "set_goal") {
      if (!value.goal) issue(["goal"], "set_goal 必须提供 goal");
      if (value.plan !== undefined || value.stepIndex !== undefined) {
        issue([], "set_goal 不允许携带 plan / stepIndex");
      }
    }
    if (value.action === "update_plan") {
      if (!value.plan) issue(["plan"], "update_plan 必须提供 plan（1–8 步）");
      if (value.goal !== undefined || value.stepIndex !== undefined) {
        issue([], "update_plan 不允许携带 goal / stepIndex");
      }
    }
    if (value.action === "set_step") {
      if (value.stepIndex === undefined) issue(["stepIndex"], "set_step 必须提供 stepIndex");
      if (value.goal !== undefined || value.plan !== undefined) {
        issue([], "set_step 不允许携带 goal / plan");
      }
    }
    if (value.action === "complete_step") {
      if (value.goal !== undefined || value.plan !== undefined || value.stepIndex !== undefined) {
        issue([], "complete_step 不允许携带 goal / plan / stepIndex");
      }
    }
  });

/**
 * Computer Use V2.1：find_desktop_element —— 在当前 observation 的控件树内做确定性检索。
 * 只读：不触发新的 UIA 扫描；返回 elementId 供 desktop_action 使用。
 */
export const findDesktopElementSchema = z
  .object({
    observationId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^obs-[A-Za-z0-9-]+$/, "observationId 必须是 observe_desktop 返回的观察 id"),
    query: z.string().trim().min(1).max(120),
    maxResults: z.number().int().min(1).max(10).optional(),
  })
  .strict();

/** V2.1：desktop_action.expect —— 动作后确定性验证 */
export const desktopActionExpectationSchema = z
  .object({
    elementAppears: z
      .object({
        role: z.string().trim().min(1).max(64).optional(),
        nameContains: z.string().trim().min(1).max(120).optional(),
        nameEquals: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .refine(
        (value) => value.role !== undefined || value.nameContains !== undefined || value.nameEquals !== undefined,
        "elementAppears 至少需要 role / nameContains / nameEquals 之一"
      )
      .optional(),
    elementDisappears: z
      .object({
        elementId: z.string().trim().regex(/^el-\d{1,4}$/, "elementId 必须是观察结果中的元素 id"),
      })
      .strict()
      .optional(),
    titleContains: z.string().trim().min(1).max(120).optional(),
    windowAppears: z
      .object({
        appName: z.string().trim().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
    textAppears: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "expect 至少需要一个检查项");

/**
 * Computer Use Phase 2：desktop_action —— 在明确授权下操作 GUI（Observe → Action → Observe）。
 * - 具备 target 的动作必须携带最近一次 observationId（观察强绑定；失效 → STALE_OBSERVATION）
 * - target 优先 elementId；坐标仅允许 normalized 0~1（禁止物理像素）
 * - 密码 / API Key / Token / Secret 等敏感信息绝不允许经 tool input
 */
export const desktopActionSchema = z
  .object({
    action: z.enum([
      "click",
      "double_click",
      "focus",
      "type",
      "key",
      "scroll",
      "wait",
      "hover",
      "right_click",
      "drag",
      "clipboard_read",
      "clipboard_write",
      "upload_file",
    ]),
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
    /** V2.5：drag 落点（必须与起点属于同一 observation） */
    to: z
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
    /** V2.5：滚动轴向（默认 vertical） */
    axis: z.enum(["vertical", "horizontal"]).optional(),
    wait: z.number().int().min(100).max(5000).optional(),
    /** V2.5：clipboard_write 文本（覆盖剪贴板前需要用户逐次确认） */
    clipboardText: z.string().min(1).max(4096).optional(),
    /** V2.5：upload_file 的工作区文件（rootId + 相对路径；renderer 解析为 grantId 后下发 Main） */
    file: z
      .object({
        rootId: z.string().trim().min(1).max(120).optional(),
        path: z.string().trim().min(1).max(512),
      })
      .strict()
      .optional(),
    /** V2.1：动作后确定性验证（发送 / 保存 / 提交类动作应提供） */
    expect: desktopActionExpectationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (!["wait", "clipboard_read", "clipboard_write"].includes(value.action) && !value.observationId) {
      issue(["observationId"], "该动作必须先 observe_desktop 并提供 observationId");
    }
    if (value.action === "wait" && value.expect !== undefined) {
      issue(["expect"], "wait 动作不允许携带 expect");
    }
    const hasElement = value.target?.elementId !== undefined;
    const hasNormalized = value.target?.normalized !== undefined;
    if (value.target && hasElement === hasNormalized) {
      issue(["target"], "target 必须且只能提供 elementId 或 normalized 之一");
    }
    const requiresTarget = ["click", "double_click", "focus", "hover", "right_click", "drag"].includes(
      value.action
    );
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
    if (["click", "double_click", "focus", "hover", "right_click"].includes(value.action)) {
      if (value.text !== undefined || value.key !== undefined || value.scroll !== undefined || value.wait !== undefined) {
        issue([], `${value.action} 动作不允许携带 text / key / scroll / wait`);
      }
    }
    if (value.axis !== undefined && value.action !== "scroll") {
      issue(["axis"], "axis 只能用于 scroll 动作");
    }
    if (value.action === "drag") {
      if (!value.to) issue(["to"], "drag 动作必须提供 to（落点）");
      else if ((value.to.elementId !== undefined) === (value.to.normalized !== undefined)) {
        issue(["to"], "to 必须且只能提供 elementId 或 normalized 之一");
      }
    } else if (value.to !== undefined) {
      issue(["to"], "to 只能用于 drag 动作");
    }
    if (value.action === "clipboard_write") {
      if (!value.clipboardText) issue(["clipboardText"], "clipboard_write 必须提供 clipboardText");
    } else if (value.clipboardText !== undefined) {
      issue(["clipboardText"], "clipboardText 只能用于 clipboard_write 动作");
    }
    if (value.action === "upload_file") {
      if (!value.file) issue(["file"], "upload_file 必须提供 file（工作区文件）");
    } else if (value.file !== undefined) {
      issue(["file"], "file 只能用于 upload_file 动作");
    }
  });
