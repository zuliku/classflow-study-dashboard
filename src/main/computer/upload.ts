/**
 * Computer Use V2.5 — 文件上传协议（系统文件选择对话框识别）。
 *
 * 契约：
 * - 只有「系统文件选择对话框」窗口才允许 upload_file（标题 + 控件双重事实）
 * - 路径由 Main 依据 grantId 解析（src/main/desktopBridge.ts 的 resolveComputerUploadPath），
 *   绝对路径绝不回传 renderer / model / audit
 * - 本模块为纯函数（无 electron 依赖），可在 node 测试环境直接验证
 */

/** 对话框标题（Windows / 常见应用本地化标题；锚定开头避免误判普通文档标题） */
const DIALOG_TITLE_PATTERN =
  /^\s*(打开|另存为|保存|选择文件|选择文件夹|上传|浏览|导入|open|save as|save|upload|choose file|choose folder|select file|browse|import)(\s|$|[·\-—:：_(（])/i;

const FILE_NAME_LABEL_PATTERN = /^(文件名|名称|file\s?name|name)\s*(\(.*\))?\s*[:：]?$/i;
const DIALOG_ACTION_PATTERN = /^(打开|保存|选择|上传|确定|open|save|choose|select|upload|ok)\s*(\(.*\))?$/i;

export interface FileDialogFacts {
  appName?: string | null;
  windowTitle?: string | null;
  /** 当前 observation 的控件名（可空；有则用于二次确认） */
  elementNames?: string[];
}

/**
 * 是否为系统文件选择对话框：
 * - 标题必须像文件对话框（锚定开头）
 * - 若已有控件树：必须能看到「文件名」字段或「打开 / 保存」按钮（避免仅凭标题误判）
 */
export function isSystemFileDialog(input: FileDialogFacts): boolean {
  const title = typeof input.windowTitle === "string" ? input.windowTitle.trim() : "";
  if (!title || !DIALOG_TITLE_PATTERN.test(title)) return false;
  const names = (input.elementNames ?? []).filter((name) => typeof name === "string" && name.trim().length > 0);
  if (names.length > 0) {
    const hasFileNameField = names.some((name) => FILE_NAME_LABEL_PATTERN.test(name.trim()));
    const hasActionButton = names.some((name) => DIALOG_ACTION_PATTERN.test(name.trim()));
    if (!hasFileNameField && !hasActionButton) return false;
  }
  return true;
}

/** 供 Prompt / 审批展示的固定说明（不包含任何路径） */
export const UPLOAD_FILE_DESCRIPTION =
  "将工作区文件路径填入系统文件选择对话框（仅限已授权工作区内的文件）";
