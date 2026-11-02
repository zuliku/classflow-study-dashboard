"use client";

/**
 * Kiro Composer — 模型入口（兼容出口）。
 *
 * 实现已迁移至 `KiroModelSelector`（ChatGPT-style 玻璃面板 + 动态背景模糊）。
 * 保留原组件名与 props，避免 Composer / 测试调用点扩散。
 */
export { KiroModelSelector as KiroComposerModelControl } from "./KiroModelSelector";
export type { KiroModelSelectorProps as KiroComposerModelControlProps } from "./KiroModelSelector";
