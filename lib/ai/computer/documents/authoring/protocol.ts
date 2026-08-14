/**
 * Document Authoring Protocol Version（V2.3）。
 *
 * Model-facing schema 可以随协议版本变化；Browser Runtime 在迁移期同时接受 V1 + V2。
 * - version 2 → 模型看到扁平 Draft Schema（text / items / string 表格）
 * - version 1 / 缺失 → 模型看到 Canonical Schema（content: [{text}] / 三层表格）
 *
 * 缺失 / 非法一律 fallback 1：旧 Browser Client 不会发送该字段 → 没有版本号 = Legacy Canonical。
 * 判定必须 deterministic（绝不根据 User-Agent / cookie / 时间 / provider）。
 */

export const CURRENT_DOCUMENT_AUTHORING_VERSION = 2 as const;

export type DocumentAuthoringVersion = 1 | 2;

export function resolveDocumentAuthoringVersion(value: unknown): DocumentAuthoringVersion {
  return value === 2 ? 2 : 1;
}
