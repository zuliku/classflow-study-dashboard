import { ComputerAdapterCapabilities } from "@/lib/ai/computer/adapters/types";

/** Chromium 真实文件夹（File System Access）adapter 能力声明 */
export function browserAdapterCapabilities(): ComputerAdapterCapabilities {
  return {
    kind: "browser",
    nativeWorkspace: true,
    canRead: true,
    canWrite: true,
    canOpenNativeFile: false,
    canRevealNativeFile: false,
  };
}
