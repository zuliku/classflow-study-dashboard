import { z } from "zod";
import { ComputerCapability, KiroAgentMode } from "@/lib/ai/computer/types";
import { DocumentAuthoringVersion } from "@/lib/ai/computer/documents/authoring/protocol";
import {
  listWorkspaceRootsSchema,
  listDirectorySchema,
  searchFilesSchema,
  grepFilesSchema,
  getFileMetadataSchema,
  readTextSchema,
  inspectDocumentSchema,
  createDirectorySchema,
  createTextFileSchema,
  patchTextFileSchema,
  deleteFileSchema,
  createDocumentRuntimeSchema,
  renameFileSchema,
  moveFileSchema,
  updateDocumentRuntimeSchema,
  createDocumentV1ModelSchema,
  createDocumentV2ModelSchema,
  updateDocumentV1ModelSchema,
  updateDocumentV2ModelSchema,
  searchWorkspaceKnowledgeSchema,
  retrieveWorkspaceContextSchema,
  runTerminalCommandSchema,
  writeTerminalInputSchema,
  startTerminalCommandSchema,
  waitTerminalCommandSchema,
  createTerminalSessionSchema,
  runTerminalSessionCommandSchema,
  writeTerminalSessionInputSchema,
  closeTerminalSessionSchema,
} from "@/lib/ai/computer/tools/schemas";

export interface ComputerToolModelContract {
  description: string;
  schema: z.ZodType;
  inputExamples?: Array<{ input: Record<string, unknown> }>;
}

export interface ComputerToolDefinition {
  name: string;
  /** Browser runtime validation（document 类工具为 runtime schema：z.unknown + 专门 parser） */
  schema: z.ZodType;
  /** 默认 description（无 modelContracts 时的 server 暴露值） */
  description: string;
  capability: ComputerCapability;
  /** 该 tool 是否 mutation（影响 regenerate guard / 调用限制） */
  mutation: boolean;
  /** V2.2：默认模型输入示例（AI SDK inputExamples） */
  inputExamples?: Array<{ input: Record<string, unknown> }>;
  /** V2.3：protocol-specific model contracts（create/update 用；普通工具不配置） */
  modelContracts?: Partial<Record<DocumentAuthoringVersion, ComputerToolModelContract>>;
}

export const COMPUTER_READ_TOOLS: ComputerToolDefinition[] = [
  {
    name: "list_workspace_roots",
    description: "列出当前 Workspace 的授权根目录（id/label/access）。",
    schema: listWorkspaceRootsSchema,
    capability: "workspace.list",
    mutation: false,
  },
  {
    name: "list_directory",
    description: "列出目录内容（从授权 root 或相对路径开始）。",
    schema: listDirectorySchema,
    capability: "fs.list",
    mutation: false,
  },
  {
    name: "search_files",
    description: "按文件名搜索工作区文件（相对路径）。",
    schema: searchFilesSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "grep_files",
    description: "在工作区文本文件中进行精确文本搜索（非正则）。",
    schema: grepFilesSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "search_workspace_knowledge",
    description: "在当前 Workspace 的本地知识索引中搜索相关文件候选；正文结论仍需实时读取文件确认。",
    schema: searchWorkspaceKnowledgeSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "retrieve_workspace_context",
    description: "在工作区知识索引定位候选文件后，实时读取少量最相关文件的有界正文片段（Grounded Context）。正文来自当前文件内容；完整段落/表格请继续用 read_text / inspect_document / grep_files。",
    schema: retrieveWorkspaceContextSchema,
    capability: "fs.search",
    mutation: false,
  },
  {
    name: "get_file_metadata",
    description: "获取文件或目录的元信息（kind/size/type）。",
    schema: getFileMetadataSchema,
    capability: "fs.read",
    mutation: false,
  },
  {
    name: "read_text",
    description: "读取文本文件（支持 startLine/endLine/maxChars 分界读取）。",
    schema: readTextSchema,
    capability: "fs.read",
    mutation: false,
  },
  {
    name: "inspect_document",
    description: "检查文档结构事实（Markdown/DOCX）：标题、章节、段落、表格等计数。",
    schema: inspectDocumentSchema,
    capability: "fs.read",
    mutation: false,
  },
];

export const COMPUTER_MUTATION_TOOLS: ComputerToolDefinition[] = [
  {
    name: "create_directory",
    description: "在工作区创建目录（已存在时返回 exists，不覆盖）。",
    schema: createDirectorySchema,
    capability: "fs.create",
    mutation: true,
  },
  {
    name: "create_text_file",
    description: "在工作区创建新文本文件（已存在时拒绝，绝不覆盖）。仅创建纯文本文件，例如 .txt / .md / .csv / .json 等；不得用于创建 DOCX/PDF/XLSX/PPTX（那些必须使用 create_document）。",
    schema: createTextFileSchema,
    capability: "fs.create",
    mutation: true,
  },
  {
    name: "patch_text_file",
    description: "对现有文本文件进行精确修改（oldText 必须唯一匹配）。仅适用于纯文本文件（.txt / .md / .csv / .json 等）；不得用于修改 DOCX/PDF/XLSX/PPTX（那些必须使用 update_document）。",
    schema: patchTextFileSchema,
    capability: "fs.modify",
    mutation: true,
  },
  {
    name: "delete_file",
    description:
      "删除工作区中的单个文件。是否需要用户确认由当前权限模式和权限规则决定（授权范围内自动模式下删除仍会请求确认）。不支持目录、递归、glob。单 root Workspace 可省略 rootId；多 root Workspace 必须使用 list_workspace_roots / list_directory 返回的 rootId。删除成功后如返回 warnings，说明文件已删除但记录同步稍延迟。",
    schema: deleteFileSchema,
    capability: "fs.delete",
    mutation: true,
    inputExamples: [
      {
        input: {
          path: "本周课表.docx",
        },
      },
      {
        input: {
          rootId: "root-xxx",
          path: "research/report.docx",
        },
      },
    ],
  },
  {
    name: "run_terminal_command",
    description:
      "在当前授权的桌面本地工作区中运行 PowerShell 或命令提示符命令（command runner，非交互终端）。用于需要真实 CLI 的操作：git（status/diff/log/add/commit）、npm/pnpm install/test/run、Python 脚本、pytest、构建与格式化（tsc/eslint/prettier）、编译器、工作区内的开发任务。默认工作目录 = 当前授权 Workspace Root（cwd 为相对路径）。普通文件读取/修改请优先使用结构化文件工具（read_text/create_text_file/patch_text_file 等），它们有更严格的沙箱与撤销能力。执行时间默认 30 秒（最多 120 秒）。ClassFlow 会识别常见删除、不可逆、系统级、嵌套 Shell 与内联任意代码操作并请求确认；普通自动执行的脚本本身仍可能具有副作用。不要通过终端绕过文件权限、用户确认或路径限制，不要自行请求提权，不要用长命令拼接多个不相关的危险操作来规避审批。",
    schema: runTerminalCommandSchema,
    capability: "shell.execute",
    mutation: true,
    inputExamples: [
      {
        input: { shell: "powershell", cwd: "", command: "git status" },
      },
      {
        input: { shell: "powershell", cwd: "frontend", command: "npm test" },
      },
      {
        input: { shell: "cmd", cwd: "", command: "python script.py" },
      },
    ],
  },
  {
    name: "write_terminal_input",
    description:
      "向当前仍在运行的终端进程写入 stdin 输入（Terminal V2，Phase 3）。用于进程明确等待输入时提供非敏感应答：确认提示（y/n）、数字选择、项目名、普通文本等。必须使用 start_terminal_command 返回的 terminalHandle。只允许非敏感输入——密码、API Key、Token、SSH secret 等敏感信息绝不可通过此工具发送，必须让用户通过界面安全输入框手动输入。输入大小有界（≤4096 字符）。进程结束后调用会被拒绝。",
    schema: writeTerminalInputSchema,
    capability: "shell.execute",
    mutation: false,
    inputExamples: [
      {
        input: { handle: "th-abc12345", data: "y" },
      },
    ],
  },
  {
    name: "start_terminal_command",
    description:
      "异步启动一个交互式终端命令并立即返回 terminalHandle（Terminal V2，Phase 3）。与 run_terminal_command 共享完全相同的 Workspace/Native root/policy/Risk/approval 安全管线。适用于需要后续 stdin 交互的命令（例如等待用户输入的脚本）。命令启动后保持运行，需配合 write_terminal_input 写入输入，并通过 wait_terminal_command 等待最终结果。普通无需交互的命令请直接使用 run_terminal_command。",
    schema: startTerminalCommandSchema,
    capability: "shell.execute",
    mutation: true,
    inputExamples: [
      {
        input: { shell: "powershell", cwd: "", command: "$x=[Console]::In.ReadLine(); Write-Output \"received:$x\"" },
      },
    ],
  },
  {
    name: "wait_terminal_command",
    description:
      "等待指定 terminalHandle 对应的交互式命令完成并返回脱敏后的最终结果（Terminal V2，Phase 3）。仅接受 start_terminal_command 返回的 opaque handle，不接受 executionId/PID。handle 进入终态后保留短 TTL，随后自动清理；已终态的 handle 再次等待将返回 TERMINAL_NOT_FOUND。",
    schema: waitTerminalCommandSchema,
    capability: "shell.execute",
    mutation: false,
    inputExamples: [
      {
        input: { handle: "th-abc12345" },
      },
    ],
  },
  {
    name: "create_terminal_session",
    description:
      "创建持久 PowerShell/cmd PTY 会话（Terminal V2，Phase 4）。会话在已授权工作区内保持 cwd/环境变量，需显式关闭。通过 shell.execute policy 与 read-write 校验；绝不接受 absolute path/env dump/elevation。返回 opaque sessionHandle（非 PID/native path）。",
    schema: createTerminalSessionSchema,
    capability: "shell.execute",
    mutation: true,
    inputExamples: [
      {
        input: { shell: "powershell", cwd: "" },
      },
    ],
  },
  {
    name: "run_terminal_session_command",
    description:
      "在已创建的持久 PTY 会话中执行单条命令（Terminal V2，Phase 4）。每条命令重新经过 shell.execute policy + Risk Classifier + approval gate，绝不绕过安全校验。使用内部随机 sentinel 探测命令结束并去除 sentinel，不暴露内部实现。会话同时仅允许一条活跃 Agent 命令。",
    schema: runTerminalSessionCommandSchema,
    capability: "shell.execute",
    mutation: true,
    inputExamples: [
      {
        input: { sessionHandle: "sh-abc12345", command: "git status" },
      },
    ],
  },
  {
    name: "write_terminal_session_input",
    description:
      "向持久 PTY 会话中等待输入的命令写入非敏感 stdin（Terminal V2，Phase 4）。仅接受 sessionHandle + data，不接受任意按键序列（Ctrl+C/ESC/Fn 等作为第一版不暴露）。敏感输入（密码/API Key/Token 等）禁止经模型路径，需用户本地输入。",
    schema: writeTerminalSessionInputSchema,
    capability: "shell.execute",
    mutation: false,
    inputExamples: [
      {
        input: { sessionHandle: "sh-abc12345", data: "y" },
      },
    ],
  },
  {
    name: "close_terminal_session",
    description: "关闭持久 PTY 会话并终止其进程树（Terminal V2，Phase 4）。幂等操作，已关闭的 handle 再次调用无副作用。",
    schema: closeTerminalSessionSchema,
    capability: "shell.execute",
    mutation: false,
    inputExamples: [
      {
        input: { sessionHandle: "sh-abc12345" },
      },
    ],
  },
  {
    name: "create_document",
    description:
      "从扁平 Document Draft 创建 .md 或 .docx。document = { title?, stylePreset?, styleHints?, blocks: [...] }；block 用纯字符串：heading/paragraph/quote 用 text；bullet-list/numbered-list 用 items: string[]；table 用 header: string[] 与 rows: string[][]（每行与表头列数一致，cell 是纯字符串，不要嵌套 [{text}] 对象）；code 用 text；page-break 无字段。文件格式由 path 扩展名决定。stylePreset 按任务自动选择：academic-cn（论文/课程作业/研究计划/调研报告/文献综述/实验报告等中文规范文档）或 business-report（商业分析/项目方案/市场报告/竞品分析/可行性分析/创业计划等现代正式报告）。styleHints 只在用户明确提出排版要求时填写；用户没有排版要求时不要生成。",
    // V2.3：Browser Runtime 用 runtime schema（document z.unknown + 专门 parser 双兼容）
    schema: createDocumentRuntimeSchema,
    capability: "document.create",
    mutation: true,
    // 默认（无 protocol 时）模型契约 = V2 Draft（当前 Client 的 modelContracts 会覆盖）
    inputExamples: [
      {
        input: {
          path: "研究总结.docx",
          document: {
            title: "研究总结",
            stylePreset: "academic-cn",
            blocks: [
              { type: "heading", level: 1, text: "研究背景" },
              { type: "paragraph", text: "这里是研究背景。" },
            ],
          },
        },
      },
      {
        input: {
          path: "本周课表.docx",
          document: {
            title: "本周课表",
            stylePreset: "business-report",
            blocks: [
              {
                type: "table",
                header: ["星期", "课程", "时间", "地点"],
                rows: [["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"]],
              },
            ],
          },
        },
      },
    ],
    modelContracts: {
      1: {
        description:
          "从 KiroDocument IR 创建 .md 或 .docx。document = { title?: string, blocks: [...] }；block 使用 canonical 结构：heading/paragraph/quote 用 content: [{ text: string }]；bullet-list/numbered-list 用 items: [[{ text }], ...]；table 用 header: [[{ text }], ...] 与 rows: [[[{ text }], ...], ...]；code 用 text；page-break 无字段。文件格式由 path 扩展名决定。stylePreset 按任务自动选择：academic-cn 或 business-report；styleHints 只在用户明确提出排版要求时填写。",
        schema: createDocumentV1ModelSchema,
        inputExamples: [
          {
            input: {
              path: "本周课表.docx",
              document: {
                title: "本周课表",
                stylePreset: "business-report",
                blocks: [
                  { type: "paragraph", content: [{ text: "本周课程安排" }] },
                  {
                    type: "table",
                    header: [[{ text: "星期" }], [{ text: "课程" }], [{ text: "时间" }], [{ text: "地点" }]],
                    rows: [[[{ text: "周一" }], [{ text: "数据结构与算法" }], [{ text: "08:00–09:40" }], [{ text: "计算机楼 102" }]]],
                  },
                ],
              },
            },
          },
        ],
      },
      2: {
        description:
          "从扁平 Document Draft 创建 .md 或 .docx。document = { title?, stylePreset?, styleHints?, blocks: [...] }；block 用纯字符串：heading/paragraph/quote 用 text；bullet-list/numbered-list 用 items: string[]；table 用 header: string[] 与 rows: string[][]（每行与表头列数一致，cell 是纯字符串，不要嵌套 [{text}] 对象）；code 用 text；page-break 无字段。文件格式由 path 扩展名决定。stylePreset 按任务自动选择：academic-cn（论文/课程作业/研究计划/调研报告等中文规范文档）或 business-report（商业分析/项目方案/市场报告等现代正式报告）。styleHints 只在用户明确提出排版要求时填写；用户没有排版要求时不要生成。",
        schema: createDocumentV2ModelSchema,
        inputExamples: [
          {
            input: {
              path: "研究总结.docx",
              document: {
                title: "研究总结",
                stylePreset: "academic-cn",
                blocks: [
                  { type: "heading", level: 1, text: "研究背景" },
                  { type: "paragraph", text: "这里是研究背景。" },
                ],
              },
            },
          },
          {
            input: {
              path: "本周课表.docx",
              document: {
                title: "本周课表",
                stylePreset: "business-report",
                blocks: [
                  {
                    type: "table",
                    header: ["星期", "课程", "时间", "地点"],
                    rows: [["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"]],
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
  {
    name: "rename_file",
    description: "在同一目录内重命名文件（newName 必须是 basename）。",
    schema: renameFileSchema,
    capability: "fs.move",
    mutation: true,
  },
  {
    name: "move_file",
    description: "在同一 Workspace 内把文件移动到另一个根目录（目标必须不存在）。",
    schema: moveFileSchema,
    capability: "fs.move",
    mutation: true,
  },
  {
    name: "update_document",
    description:
      "更新 Kiro 创建的 Markdown/DOCX Artifact；必须提供当前 expectedRevision。document 使用与 create_document 完全相同的扁平 Document Draft（含可选 stylePreset/styleHints）。不提供 style 时自动保持既有排版；用户明确要求改排版（如切换 preset / 调整字号）时通过 stylePreset/styleHints 表达。",
    schema: updateDocumentRuntimeSchema,
    capability: "document.modify",
    mutation: true,
    modelContracts: {
      1: {
        description:
          "更新 Kiro 创建的 Markdown/DOCX Artifact；必须提供当前 expectedRevision。document 使用与 create_document 相同的 canonical KiroDocument IR（content: [{ text }] 结构）。不提供 style 时自动保持既有排版。",
        schema: updateDocumentV1ModelSchema,
        inputExamples: [
          {
            input: {
              artifactId: "artifact-xxx",
              expectedRevision: 1,
              document: {
                title: "研究方案",
                blocks: [{ type: "paragraph", content: [{ text: "引言" }] }],
              },
            },
          },
        ],
      },
      2: {
        description:
          "更新 Kiro 创建的 Markdown/DOCX Artifact；必须提供当前 expectedRevision。document 使用与 create_document 完全相同的扁平 Document Draft（含可选 stylePreset/styleHints）。不提供 style 时自动保持既有排版；用户明确要求改排版（如切换 preset / 调整字号）时通过 stylePreset/styleHints 表达。",
        schema: updateDocumentV2ModelSchema,
        inputExamples: [
          {
            input: {
              artifactId: "artifact-xxx",
              expectedRevision: 1,
              document: {
                title: "研究方案",
                blocks: [
                  { type: "heading", level: 1, text: "引言" },
                  { type: "table", header: ["指标", "数值"], rows: [["增速", "12%"]] },
                ],
              },
            },
          },
        ],
      },
    },
  },
];

export const COMPUTER_TOOLS: ComputerToolDefinition[] = [
  ...COMPUTER_READ_TOOLS,
  ...COMPUTER_MUTATION_TOOLS,
];

export const COMPUTER_TOOL_NAMES = new Set(COMPUTER_TOOLS.map((t) => t.name));

/** Mutation 工具名（regenerate guard / 调用限制使用） */
export const COMPUTER_MUTATION_TOOL_NAMES = new Set(COMPUTER_MUTATION_TOOLS.map((t) => t.name));

/**
 * 按 Agent Mode 暴露工具（server 过滤；不是安全边界——executor 仍独立 policy 求值）：
 * - plan：只读工具
 * - guided / workspace-auto：read + mutation
 */
export function getComputerToolsForMode(mode: KiroAgentMode): ComputerToolDefinition[] {
  if (mode === "plan") return COMPUTER_READ_TOOLS;
  return COMPUTER_TOOLS;
}
