/**
 * Kiro Assistant Turn Presentation（Streaming Worklog V2）。
 *
 * 实现已迁移至 lib/ai/presentation/liveTurnPresentation.ts（Live Turn Presentation
 * Controller：单调 lane commit + provisional leading / trailing lookahead + answerStreaming）。
 * 本模块保留原公共 API（deriveKiroAssistantTurn / 类型），避免 import 链路断裂。
 */

export * from "./liveTurnPresentation";
