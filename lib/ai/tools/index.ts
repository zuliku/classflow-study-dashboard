import { KIRO_READ_TOOLS } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOLS } from "@/lib/ai/tools/write/registry";

/** Kiro 全部工具（Read + Write）：Server 提供 schema，Client 按同名执行 */
export const KIRO_TOOLS = {
  ...KIRO_READ_TOOLS,
  ...KIRO_WRITE_TOOLS,
};
