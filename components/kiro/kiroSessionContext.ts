/**
 * Kiro Session Contexts（HMR 稳定模块）。
 *
 * 为什么单独成文件：Vite React Refresh 热更新 `KiroSessionProvider.tsx` 时，
 * 若 Context 对象定义在 Provider 模块内，Provider 会拿到「新 Context」，
 * 而未被同时替换的消费者仍读「旧 Context」→ useKiroSession 抛错 / 白屏。
 * 把 Context 定义放在这个不常改动的模块里，Provider 与消费者共享同一 Context 身份。
 *
 * 只放 createContext（类型仅 type-only 引用 Provider，避免运行时循环依赖）。
 */
import { createContext } from "react";
import type {
  KiroRuntimeValue,
  KiroSessionMetaValue,
  KiroSessionActionsValue,
  KiroSessionValue,
} from "@/components/kiro/KiroSessionProvider";

export const KiroRuntimeContext = createContext<KiroRuntimeValue | null>(null);
export const KiroSessionMetaContext = createContext<KiroSessionMetaValue | null>(null);
export const KiroSessionActionsContext = createContext<KiroSessionActionsValue | null>(null);
export const KiroSessionContext = createContext<KiroSessionValue | null>(null);
