/**
 * Skill IPC — Main Process
 * 通道：bridge:skill:*
 * 仅 Main 管理文件，Renderer 只通过 IPC 操作
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import { listSkills, getSkill, createSkill, updateSkill, deleteSkill, setSkillEnabled, importSkill, exportSkill, testSkill } from "@/src/main/skills/skillStore";
import { activateSkill } from "@/lib/ai/skills/activation";

function toIpcError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    throw new Error(JSON.stringify({ code: parsed.code ?? e?.code ?? "UNKNOWN", message: parsed.message ?? e?.message ?? raw }));
  } catch {
    throw new Error(JSON.stringify({ code: e?.code ?? "UNKNOWN", message: e?.message ?? raw }));
  }
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
      const skills = listSkills();
      return {
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          folderName: s.folderName,
          enabled: s.enabled,
          license: s.license,
          compatibility: s.compatibility,
          metadata: s.metadata,
          triggers: s.triggers,
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
      const data = input as { name?: string; description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> };
      const result = createSkill({
        name: data.name ?? "",
        description: data.description ?? "",
        instructions: data.instructions ?? "",
        license: data.license,
        compatibility: data.compatibility,
        metadata: data.metadata,
      });
      return { skill: { name: result.name, description: result.description, enabled: result.enabled } };
    } catch (err) {
      toIpcError(err);
    }
  });

  ipcMain.handle("bridge:skill:update", (event, input: unknown) => {
    if (!guard("bridge:skill:update", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const data = input as { name?: string; description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> };
      if (!data.name) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "name required" }));
      const result = updateSkill(data.name, {
        description: data.description,
        instructions: data.instructions,
        license: data.license,
        compatibility: data.compatibility,
        metadata: data.metadata,
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

  ipcMain.handle("bridge:skill:importPath", (event, input: unknown) => {
    if (!guard("bridge:skill:importPath", event)) throw new Error(JSON.stringify({ code: "PERMISSION_DENIED" }));
    try {
      const { path } = input as { path?: string };
      if (!path) throw new Error(JSON.stringify({ code: "INVALID_INPUT", message: "path required" }));
      const imported = importSkill(path);
      return { skill: { name: imported.name, description: imported.description, enabled: imported.enabled } };
    } catch (err) {
      toIpcError(err);
    }
  });

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
      const skills = listSkills();
      const result = activateSkill(skills, { skillName: skillName ?? "" });
      if (!result.ok) throw new Error(JSON.stringify({ code: result.code ?? "NOT_FOUND", message: result.error }));
      return result;
    } catch (err) {
      toIpcError(err);
    }
  });
}
