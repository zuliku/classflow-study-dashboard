/**
 * Kiro Web Search — 运行时能力真值（server-authored）。
 *
 * 目的：模型不再只从 tools 列表猜测“能不能搜”；本轮可用性、基础/增强模式、
 * 不可用原因都在 System Prompt 中明确。该段绝不包含 Key、provider 原始信息或额度。
 */
import type { KiroWebSearchAccess } from "@/lib/ai/web/types";

export type KiroWebSearchMode = "off" | "basic" | "enhanced" | "unavailable";

export interface KiroWebSearchCapabilityInput {
  enabled: boolean;
  access: KiroWebSearchAccess | null | undefined;
  /** 纯文本追答轮：零工具，必须与 textOnlySuffix 一致 */
  textOnlyAnswer?: boolean;
  /** remote-channel（QQ/邮件）：额度更低，Prompt 必须说明 */
  remote?: boolean;
}

export function resolveKiroWebSearchMode(input: KiroWebSearchCapabilityInput): KiroWebSearchMode {
  if (!input.enabled || input.textOnlyAnswer) return "off";
  if (!input.access) return "unavailable";
  if (!input.access.ok) return "unavailable";
  return input.access.kind === "keyless" ? "basic" : "enhanced";
}

export function isKiroWebSearchAvailable(input: KiroWebSearchCapabilityInput): boolean {
  const mode = resolveKiroWebSearchMode(input);
  return mode === "basic" || mode === "enhanced";
}

/**
 * 能力段（注入 System Prompt）。四种状态必须互斥：
 * - off：用户关闭 / 纯文本追答
 * - basic：默认免 Key 基础搜索
 * - enhanced：Tavily Key 已配置
 * - unavailable：BYOK 缺 Key 或 keyless 被运营开关禁用
 */
export function buildKiroWebSearchCapabilitySection(input: KiroWebSearchCapabilityInput): string {
  const mode = resolveKiroWebSearchMode(input);
  if (mode === "off") {
    return "\n\n# 联网搜索能力（本轮）\n本轮联网搜索不可用（已关闭或当前为纯文本追答）。不要调用 web_search / web_research，不要声称已经搜索，也不要引用网页来源。";
  }
  if (mode === "unavailable") {
    return "\n\n# 联网搜索能力（本轮）\n本轮联网搜索不可用（用户选择了自备搜索 Key，但尚未配置）。不要调用 web_search / web_research，不要引用网页来源；如需最新外部信息，提示用户在设置中填写 Tavily API Key，或切换到自动搜索。";
  }
  const limit = input.remote
    ? "本轮为远程渠道（QQ/邮件），最多 1 次搜索、1 次读取（web_research 也按 query 数计入）；"
    : "每轮最多 5 次搜索、3 次读取（web_research 的每个 query 同样消耗搜索次数）；";
  if (mode === "basic") {
    return `\n\n# 联网搜索能力（本轮）\n本轮联网搜索可用：基础搜索（免 Key）。遇到新闻、政策、公告、招生、价格、版本、赛事等时效性外部信息时，默认先自主搜索，不要先问用户。${limit}多角度研究可用 web_research 一次覆盖 2–5 个方向；单点查证用 web_search。中文关键词结果不相关时，可用英文关键词/官方英文名再搜一次。搜索服务限流或失败时如实说明，不要编造来源、标题或日期。`;
  }
  return `\n\n# 联网搜索能力（本轮）\n本轮联网搜索可用：增强搜索（用户已配置 Tavily Key）。按现有 Kiro Search 策略自主使用；需要最新外部信息时直接搜索，不需要先征求用户同意。${limit}多角度研究可用 web_research 一次覆盖 2–5 个方向；单点查证用 web_search。`;
}
