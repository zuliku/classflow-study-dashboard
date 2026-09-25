// @vitest-environment node
/**
 * 桌面端 UI 产品化（P3）— 文案精简回归守卫。
 *
 * 目的：防止已删除的冗余 / demo 化文案回潮（"…会显示在这里"、隐私 lecture、技术实现细节、
 * 「（可选）」、状态旁白等）。只做源码字符串断言，不渲染组件。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

const FILLER = [
  "会显示在这里",
  "先连接一个 AI 服务即可开始使用 Kiro。",
  "文件内容会发送给当前选择的 AI 服务以完成你的请求。",
  "Kiro 会按需读取你的 ClassFlow 数据",
  "对 Kiro 说「记住我一般晚上学习」",
  "仅分享当前对话中可见的内容",
  "不支持 Web Share 时自动复制",
  "历史记录（仅展示，不能撤销）",
  "本任务共",
  "需要调整策略：Kiro 正在重新观察并更新计划",
  "Kiro 在此项目中的工作偏好。不会授予额外权限。",
  "发送第一条消息后，对话会自动保存在本机。",
  "用项目整理相关的 Kiro 对话。",
  "正文由 Kiro 按需读取，不会自动发送全部资料。",
  "所选上下文会随消息发送，Kiro 将据此优先查询。",
  "仅保存在本次应用会话",
  "坐标回退）",
  "沙箱与只读边界",
  "所有操作都限定在你授权的范围内",
  "记住学习偏好并持续运用",
  "JPG / PNG / WEBP",
];

const UI_FILES = [
  "components/kiro/KiroEmptyState.tsx",
  "components/kiro/KiroComposer.tsx",
  "components/kiro/KiroMemoryManager.tsx",
  "components/kiro/KiroShareSheet.tsx",
  "components/kiro/KiroHistoryPanel.tsx",
  "components/kiro/KiroConversation.tsx",
  "components/kiro/KiroMessage.tsx",
  "components/kiro/KiroContextPicker.tsx",
  "components/kiro/KiroMaterialPicker.tsx",
  "components/kiro/KiroAttachmentPicker.tsx",
  "components/kiro/KiroAttachmentChip.tsx",
  "components/kiro/navigation/KiroNavigatorProjectForm.tsx",
  "components/kiro/navigation/KiroNavigatorProjects.tsx",
  "components/kiro/navigation/KiroNavigatorSearch.tsx",
  "components/kiro/inspector/KiroInspectorOutputs.tsx",
  "components/kiro/inspector/KiroInspectorSources.tsx",
  "components/kiro/computer/KiroRecentArtifactsPopover.tsx",
  "components/kiro/run/KiroAgentRun.tsx",
  "components/kiro/run/KiroAgentRunHeader.tsx",
  "components/kiro/run/KiroAgentRunResult.tsx",
  "components/kiro/run/KiroInlineApproval.tsx",
  "components/kiro/computer/session/KiroComputerSessionSurface.tsx",
  "components/kiro/computer/session/KiroComputerSessionHeader.tsx",
  "components/kiro/computer/session/KiroComputerSessionPreview.tsx",
  "components/kiro/computer/KiroComputerSessionHost.tsx",
  "components/kiro/computer/ComputerApprovalDialog.tsx",
  "components/kiro/computer/KiroWorkspacePicker.tsx",
  "components/settings/KiroAgentSettings.tsx",
  "components/settings/KiroAISettings.tsx",
  "components/settings/KiroMemorySettings.tsx",
];

describe("桌面端文案产品化 — 冗余 / demo 化文案不得回潮", () => {
  it.each(UI_FILES)("%s 不含已清理的填充文案", (file) => {
    const source = read(file);
    for (const needle of FILLER) {
      expect(source, `${file} 不应包含「${needle}」`).not.toContain(needle);
    }
  });

  it("空态保持单行（无第二行解释）", () => {
    expect(read("components/kiro/KiroEmptyState.tsx")).not.toContain("data-kiro-empty-subtitle");
    expect(read("components/kiro/inspector/KiroInspectorOutputs.tsx")).not.toMatch(/hint=/);
    expect(read("components/kiro/inspector/KiroInspectorSources.tsx")).not.toMatch(/hint=/);
  });

  it("设置描述保持简短（无「开启后 Kiro 才能…」模板句）", () => {
    for (const file of ["components/settings/KiroAgentSettings.tsx", "components/settings/KiroAISettings.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("开启后 Kiro 才能");
      expect(source, file).not.toContain("默认关闭；开启后");
    }
  });

  it("项目表单占位符精简（无长「例如：」模板）", () => {
    const form = read("components/kiro/navigation/KiroNavigatorProjectForm.tsx");
    expect(form).toContain('placeholder="例如：回答使用中文，引用注明来源。"');
    expect(form).not.toContain("（可选）");
  });
});
