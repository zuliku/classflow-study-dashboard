/**
 * Mini 审批可执行性（纯策略辅助）：
 * 只有“低风险 + 前台 + Runtime 允许 allow-once”的请求才能直接在 Mini 批准。
 * 高风险 / 后台静默 / 仅 session/workspace 授权的请求只能在主窗口处理。
 */
import type { ComputerApprovalRequest } from "@/lib/ai/computer/approval";
import { getComputerApprovalPresentation } from "@/lib/ai/ui/computerApprovalPresentation";

export function canApproveInMini(request: ComputerApprovalRequest): boolean {
  if (request.background === true) return false;
  if (!request.allowedDecisions.includes("allow-once")) return false;
  return !getComputerApprovalPresentation(request).highRisk;
}
