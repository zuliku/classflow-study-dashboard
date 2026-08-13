/**
 * ComputerAdapter 能力契约（V1）。
 * 只含 filesystem/document-oriented 能力声明；shell / process / network 不属于本接口
 * （未来属于独立 capability domain）。
 */
export type ComputerAdapterKind = "browser" | "sandbox";

export interface ComputerAdapterCapabilities {
  kind: ComputerAdapterKind;
  /** 是否真实 native 文件夹（File System Access）；false = IndexedDB sandbox */
  nativeWorkspace: boolean;
  canRead: boolean;
  canWrite: boolean;
  canOpenNativeFile: boolean;
  canRevealNativeFile: boolean;
}
