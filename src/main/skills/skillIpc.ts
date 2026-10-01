/**
 * Skill IPC — Main Process
 * 通道：bridge:skill:*
 * 仅 Main 管理文件，Renderer 只通过 IPC 操作
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import { listSkills, getSkill, createSkill, updateSkill, deleteSkill, setSkillEnabled, importSkill, exportSkill, testSkill } from "@/src/main/skills/skillStore";
import { activateSkill } from "@/lib/ai/skills/activation";
import { withBuiltinSkills } from "@/lib/ai/skills/builtin";
import { listWorkflowSkills } from "@/lib/ai/skills/registry";
import { toSanitizedIpcError } from "@/src/main/security/ipcErrors";

function toIpcError(err: unknown): never {
  // code 保留（调用方按 code 分支），message 脱敏（路径/用户名不出 Main）
  return toSanitizedIpcError(err);
}

export function registerSkillIpc(opts?: {
  validateSender?: (channel: string, event: Electron.IpcMainInvokeEvent) => boolean;
}): void {
  const guard = (channel: string, event: Electron.IpcMainInvokeEvent): boolean => {
    if (!opts?.validateSender) return true;
    return opts.validateSender(channel, event);
  };

  ipcMain.handle("bridge:skill:list", (event) => {
    if (!guard("bridge:skill:list", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const skills = withBuiltinSkills(listSkills());
      return {
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          folderName: s.folderName,
          enabled: s.enabled,
          // S1：canonical 分类 / 来源（UI 与 Slash 只读这些字段，不再靠 prefix / metadata.builtin 猜测）
          kind: s.kind,
          origin: s.origin,
          license: s.license,
          compatibility: s.compatibility,
          metadata: s.metadata,
          legacyTriggers: s.legacyTriggers,
          requiredTools: s.requiredTools,
          lastUsedAt: s.lastUsedAt,
        })),
      };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:get", (event, input: unknown) => {
    if (!guard("bridge:skill:get", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name } = input as { name?: string };
      if (!name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      const pkg = getSkill(name);
      if (!pkg) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
      return { skill: pkg };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:create", (event, input: unknown) => {
    if (!guard("bridge:skill:create", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const data = input as { name?: string; description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown>; kiroManifest?: unknown };
      const result = createSkill({
        name: data.name ?? "",
        description: data.description ?? "",
        instructions: data.instructions ?? "",
        license: data.license,
        compatibility: data.compatibility,
        metadata: data.metadata,
        kiroManifest: data.kiroManifest,
      });
      return { skill: { name: result.name, description: result.description, enabled: result.enabled } };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:update", (event, input: unknown) => {
    if (!guard("bridge:skill:update", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const data = input as { name?: string; description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown>; kiroManifest?: unknown };
      if (!data.name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      const result = updateSkill(data.name, {
        description: data.description,
        instructions: data.instructions,
        license: data.license,
        compatibility: data.compatibility,
        metadata: data.metadata,
        kiroManifest: data.kiroManifest,
      });
      return { skill: { name: result.name, description: result.description, enabled: result.enabled } };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:delete", (event, input: unknown) => {
    if (!guard("bridge:skill:delete", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name } = input as { name?: string };
      if (!name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      deleteSkill(name);
      return { ok: true };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:setEnabled", (event, input: unknown) => {
    if (!guard("bridge:skill:setEnabled", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name, enabled } = input as { name?: string; enabled?: boolean };
      if (!name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      setSkillEnabled(name, Boolean(enabled));
      return { ok: true };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:import", async (event) => {
    if (!guard("bridge:skill:import", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "选择 Skill 文件夹（包含 SKILL.md）" })
        : await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择 Skill 文件夹" });
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
      const sourcePath = result.filePaths[0];
      const imported = importSkill(sourcePath);
      return { skill: { name: imported.name, description: imported.description, enabled: imported.enabled } };
    } catch (err) {
      toIpcError(err);
    }
  });

  // bridge:skill:importPath 已移除（BUG-037）：renderer 可传任意路径 = 绕过 grant 模型；
  // 无生产调用方。导入统一走 bridge:skill:import 原生目录选择器。

  ipcMain.handle("bridge:skill:export", (event, input: unknown) => {
    if (!guard("bridge:skill:export", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name } = input as { name?: string };
      if (!name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      const content = exportSkill(name);
      return { content };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:test", (event, input: unknown) => {
    if (!guard("bridge:skill:test", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { name } = input as { name?: string };
      if (!name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      const result = testSkill(name);
      return result;
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:activate", (event, input: unknown) => {
    if (!guard("bridge:skill:activate", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { skillName } = input as { skillName?: string };
      // 只允许激活 Workflow Skill（Recipe 不在候选中，绝不 fallback）
      const workflows = listWorkflowSkills(withBuiltinSkills(listSkills()));
      const result = activateSkill(workflows, { skillName: skillName ?? "" });
      if (!result.ok) throw new Error(JSON.stringify({ code: result.code ?? "NOT_FOUND", message: result.error }));
      return result;
    } catch (err) {
      toIpcError(err);
    }
  });
}
