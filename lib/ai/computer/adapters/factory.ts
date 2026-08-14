/**
 * Computer Adapter Factory（V2.8）。
 *
 * 按 adapterRef 构造统一 IO 接口（browser / sandbox runtime）。
 * 独立模块：executor / deleteFile / artifacts.access / Undo / relocation /
 * Knowledge / Settings 面板等所有调用方统一从这里 import——
 * 消除「deleteFile.ts → executor.ts → deleteFile.ts」循环依赖。
 */

import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import {
  sandboxListDirectory,
  sandboxStat,
  sandboxReadText,
  sandboxReadBytes,
  sandboxCreateDirectory,
  sandboxWriteText,
  sandboxWriteBytes,
  sandboxRemove,
  sandboxMove,
  sandboxReadTextPrefix,
} from "@/lib/ai/computer/adapters/sandbox";
import {
  browserListDirectory,
  browserStat,
  browserReadText,
  browserReadBytes,
  browserCreateDirectory,
  browserWriteText,
  browserWriteBytes,
  browserRemove,
  browserMove,
  browserReadTextPrefix,
} from "@/lib/ai/computer/adapters/browser";

/** 按 adapterRef 构造统一 IO 接口（browser / sandbox runtime） */
export function getComputerAdapterForAdapterRef(adapterRef: string): ComputerAdapterIO {
  const isSandbox = adapterRef === "sandbox-default" || adapterRef.startsWith("sandbox");
  if (isSandbox) {
    return {
      list: (p) => sandboxListDirectory(adapterRef, p).then((items) => items.map((i) => ({ name: i.name, kind: i.entry.kind, size: i.entry.size }))),
      stat: (p) => sandboxStat(adapterRef, p).then((e) => (e ? { kind: e.kind, size: e.size, type: e.type } : null)),
      readText: (p) => sandboxReadText(adapterRef, p),
      readBytes: (p) => sandboxReadBytes(adapterRef, p),
      createDirectory: (p) => sandboxCreateDirectory(adapterRef, p),
      writeText: (p, c, t) => sandboxWriteText(adapterRef, p, c, t),
      writeBytes: (p, c, t) => sandboxWriteBytes(adapterRef, p, c, t),
      remove: (p, k) => sandboxRemove(adapterRef, p, k),
      move: (from, to) => sandboxMove(adapterRef, from, to),
      readTextPrefix: (p, maxBytes) => sandboxReadTextPrefix(adapterRef, p, maxBytes),
    };
  }
  return {
    list: (p) => browserListDirectory(adapterRef, p),
    stat: (p) => browserStat(adapterRef, p),
    readText: (p) => browserReadText(adapterRef, p),
    readBytes: (p) => browserReadBytes(adapterRef, p),
    createDirectory: (p) => browserCreateDirectory(adapterRef, p),
    writeText: (p, c) => browserWriteText(adapterRef, p, c),
    writeBytes: (p, c) => browserWriteBytes(adapterRef, p, c),
    remove: (p, k) => browserRemove(adapterRef, p, k),
    move: (from, to) => browserMove(adapterRef, from, to),
    readTextPrefix: (p, maxBytes) => browserReadTextPrefix(adapterRef, p, maxBytes),
  };
}
