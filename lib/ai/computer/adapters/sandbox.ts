import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";

/** Kiro Sandbox（IndexedDB 虚拟工作区）adapter 能力声明。
 *  UI 必须明确展示「Sandbox · 当前浏览器」，绝不称为本地文件夹。 */
export function sandboxAdapterCapabilities(): ComputerAdapterCapabilities {
  return {
    kind: "sandbox",
    nativeWorkspace: false,
    canRead: true,
    canWrite: true,
    canOpenNativeFile: false,
    canRevealNativeFile: false,
  };
}

/** Sandbox 的 IndexedDB 命名空间（Part 2 存放真实文件记录） */
export const KIRO_SANDBOX_DB = "classflow-kiro-sandbox-v1";
export const KIRO_SANDBOX_FILES_STORE = "files";
