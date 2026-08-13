# Kiro Computer Agent V1 Part 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Kiro Computer Agent V1 with interactive approvals, message-owned Agent Tasks, reviewable Computer changes, task-level session Undo, bounded audit metadata, safe conversation-history restore, and regenerate hardening.

**Architecture:** Keep `lib/ai/computer/*` as a separate trust domain. `ask` pauses the exact client tool call without mutation or tool output; approval resumes only that call through the same sandbox/policy/grant checks. Model-safe tool output is separated from runtime-only review/checkpoint facts. Reuse the existing Kiro conversation persistence (`lib/ai/history/types.ts` + `sanitize.ts` + `KiroSessionProvider`) for display-only Computer task history instead of creating a parallel conversation-history database.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, IndexedDB, File System Access API, existing Dialog/Button primitives, Vitest 4, fake-indexeddb, Playwright.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Continue from Part 2 HEAD `eb514b3` or newer; preserve Part 1/2 reasoning, workspace, permission, tool, Markdown/DOCX, and verification behavior.
- Approval may satisfy only a policy result that is already `ask`. It must never override `deny`, hard deny, read-only roots, `PATH_OUTSIDE_SANDBOX`, missing/revoked grants, or adapter errors.
- The model cannot choose approval persistence. No Computer schema may add `permission`, `approval`, `remember`, `force`, `unsafe`, or `skipCheck`.
- No model-facing delete/move/rename, shell/PowerShell/cmd, app launch, MCP, arbitrary network, or Full Access tools in V1.
- Internal Undo may remove only resources created by the same task. This is runtime restoration, not an LLM delete capability.
- Mutation and Undo success require verification.
- Task/progress UI shows factual runtime activity only, never hidden reasoning.
- Never persist/send native paths, `adapterRef`, `FileSystemDirectoryHandle`, permission tokens, file bytes, checkpoint snapshots, or raw full-file content.
- Patch Undo before-text is runtime-only and remains bounded by the existing 1 MiB patch source limit.
- Audit metadata keeps at most 500 entries.
- Remove Part 2's turn-global `computerActions` footer; tasks/changes attach to the assistant message owning their toolCallIds.
- Centralize Browser grant IndexedDB lookup in `lib/ai/computer/workspace/grants.ts`; Browser adapter must not duplicate grant DB constants/access.
- Tests are deterministic/offline. Part 3 Playwright must not require a real model/API. Reuse an existing AI route mock if available; otherwise intercept `/api/ai/chat` with a deterministic AI SDK-compatible tool-call stream for this test only.
- Run targeted Part 3 Vitest + one Computer E2E + typecheck. No full suites/screenshot regression/build by default.

---

## File Map

### Create
- `lib/ai/computer/approval.ts`
- `lib/ai/computer/task.ts`
- `lib/ai/computer/checkpoints.ts`
- `lib/ai/computer/audit.ts`
- `store/useKiroComputerRuntimeStore.ts`
- `components/kiro/computer/ComputerApprovalDialog.tsx`
- `components/kiro/computer/KiroAgentTaskCard.tsx`
- `components/kiro/computer/KiroChangeReviewDialog.tsx`
- `components/settings/KiroComputerAuditPanel.tsx`
- `tests/unit/kiro-computer-approval.test.ts`
- `tests/unit/kiro-computer-checkpoints.test.ts`
- `tests/unit/kiro-computer-history-audit.test.ts`
- `tests/e2e/kiro-computer-agent-v1.spec.ts`

### Modify
- `lib/ai/computer/types.ts`
- `lib/ai/computer/result.ts`
- `lib/ai/computer/executor.ts`
- `lib/ai/computer/executor-types.ts`
- `lib/ai/computer/adapters/browser.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/computer/workspace/grants.ts`
- `store/useKiroComputerStore.ts`
- `hooks/useKiroChat.ts`
- `components/kiro/KiroChatSurface.tsx`
- `components/kiro/KiroConversation.tsx`
- `components/kiro/computer/KiroComputerActionCard.tsx`
- `components/settings/KiroAgentSettings.tsx`
- `lib/ai/history/types.ts`
- `lib/ai/history/sanitize.ts`
- `tests/unit/kiro-computer-tools.test.ts`

Do not create a second Computer conversation-history DB. Existing `KiroSessionProvider` already persists `sanitizeConversation(...)` to `lib/ai/history/db.ts`; extend that pipeline.

---

## Core Interfaces

```ts
export type ComputerApprovalDecision =
  | "deny"
  | "allow-once"
  | "allow-session"
  | "allow-workspace";

export interface ComputerApprovalRequest {
  id: string;
  toolCallId: string;
  taskId: string;
  capability: ComputerCapability;
  risk: ComputerRisk;
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  resourceLabel: string;
  description: string;
  allowedDecisions: ComputerApprovalDecision[];
}

export interface ComputerOneShotApproval {
  approvalId: string;
  toolCallId: string;
  capability: ComputerCapability;
  workspaceId: string;
  rootId?: string;
  relativePath?: string;
}

export type ComputerExecutionAttempt =
  | { kind: "completed"; output: ComputerToolResult; runtime?: ComputerRuntimeMutation }
  | { kind: "approval-required"; request: ComputerApprovalRequest };
```

Only `completed.output` goes to `chat.addToolOutput`.

```ts
export type KiroAgentTaskStatus =
  | "running"
  | "awaiting_permission"
  | "completed"
  | "failed"
  | "cancelled"
  | "undone"
  | "undo_failed";

export interface KiroAgentTaskStep {
  id: string;
  toolCallId: string;
  label: string;
  status: "running" | "awaiting_permission" | "done" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface KiroComputerChange {
  id: string;
  toolCallId: string;
  operation: "create" | "modify";
  resourceType: "directory" | "text" | "document";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  verification: "passed";
  review:
    | { kind: "create"; preview?: string }
    | { kind: "text-patch"; edits: Array<{ before: string; after: string }> }
    | { kind: "document"; title?: string; headings: string[]; paragraphs: number; lists: number; tables: number; codeBlocks: number; characters: number };
}

export interface KiroAgentTask {
  id: string;
  conversationId: string | null;
  userMessageId: string;
  assistantMessageId?: string;
  title: string;
  status: KiroAgentTaskStatus;
  steps: KiroAgentTaskStep[];
  changes: KiroComputerChange[];
  toolCallIds: string[];
  canUndo: boolean;
  undoUsed: boolean;
  startedAt: string;
  completedAt?: string;
}
```

Conversation persistence uses a narrower `PersistedComputerTaskView` and omits review text, checkpoints, native data, and executable Undo.

---

### Task 1: Interactive Approval + Grant Store Boundary + Message Ownership

**Files:** approval/task/runtime store/dialog; `result.ts`, `executor.ts`, grants/browser adapter, `useKiroChat.ts`, `KiroChatSurface.tsx`, `KiroConversation.tsx`; approval/tools tests.

- [ ] Write failing tests: Guided patch returns `approval-required` and leaves file unchanged; exact one-shot matches only same toolCall/capability/workspace/root/path; different resource fails; explicit/hard deny never produces approval; session/workspace rule shape is correct.
- [ ] RED:
```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
```
- [ ] Export runtime-only `getBrowserWorkspaceDirectoryHandle(adapterRef)` from `workspace/grants.ts`; remove duplicate grant DB constants/direct lookup from `adapters/browser.ts`. `showDirectoryPicker()` and `requestPermission()` remain user-gesture helpers only.
- [ ] Implement approval helpers. `allow-once` is exact in-memory; `allow-session` is exact-resource + `scope:"session"`; `allow-workspace` is capability + workspace + `scope:"persistent"`. These helpers are invoked only after `policy.effect === "ask"`.
- [ ] Refactor executor:
```text
schema → frozen snapshot/live workspace → sandbox/path → policy
→ deny: completed false output
→ ask/no one-shot: approval-required, NO IO
→ ask/exact one-shot: continue
→ live grant/adapter → execute → verify → completed
```
Remove the Part 2 Guided-patch special case; policy effect is authoritative.
- [ ] `useKiroComputerRuntimeStore` holds only `pendingApproval` and `reviewTaskId`; pending executable input/snapshot stays in hook refs.
- [ ] In `useKiroChat`, approval-required means no `addToolOutput`. Keep exact pending call in ref. Deny sends one `USER_CANCELLED` output. Other decisions rerun the exact call via one-shot or newly-added rule. Recheck live workspace/rules/grant on resume. Stop/newChat/loadConversation/unmount clears stale approval.
- [ ] Build dedicated shared-Dialog approval UI with safe logical workspace/root/path and only request-authorized decision buttons.
- [ ] Create one live Computer task per Computer-enabled user turn, append factual tool steps/toolCallIds, and attach it to the assistant message containing those tool ids. Remove global `computerActions` footer rendering.
- [ ] GREEN + commit:
```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -am "feat(kiro): add interactive computer approvals"
```
Stage newly-created files explicitly before commit.

---

### Task 2: Change Review + Verified Checkpoint/Undo

**Files:** `checkpoints.ts`, Task/Review cards, `result.ts`, `executor.ts`, `executor-types.ts`, Browser/Sandbox adapters, `useKiroChat.ts`, `KiroConversation.tsx`, Computer Action Card, checkpoint/tools tests.

Checkpoint:
```ts
export type ComputerInverseOperation =
  | { type: "remove-created"; workspaceId: string; rootId: string; relativePath: string; resourceType: "file" | "directory" }
  | { type: "restore-text"; workspaceId: string; rootId: string; relativePath: string; beforeText: string };

export interface ComputerTaskCheckpoint {
  taskId: string;
  inverses: ComputerInverseOperation[];
  used: boolean;
}
```

- [ ] Write failing tests: create text/docx/empty-directory Undo; patch exact restoration; reverse-order mixed Undo; second Undo rejected; non-empty directory removal rejected; revoked grant fails; every inverse verified.
- [ ] Extend runtime-only `ComputerAdapterIO` with `remove(path, kind)`. Browser removal is non-recursive. Sandbox removal deletes only exact file or empty directory. Do not add a model tool.
- [ ] Separate model-safe output from `ComputerRuntimeMutation`. Verified mutation runtime facts create inverses and bounded review data: create preview first 2000 chars; patch exact before/after edit pairs + full beforeText only in checkpoint; document structural facts from validated IR.
- [ ] `KiroAgentTaskCard` renders inside owning assistant message. Completed task shows `[查看更改]` and `[撤销本次更改]` only if checkpoint exists/unused. Review truncates each patch side to 2000 display chars and never shows native paths/adapterRef.
- [ ] Checkpoint registry is a `useKiroChat` ref keyed taskId. Undo resolves current live workspace/root/grant, executes inverse operations in reverse, verifies each, then marks used/undone. Any failure stops and sets `undo_failed`; never claim full rollback.
- [ ] Verify + commit:
```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
git add lib/ai/computer hooks/useKiroChat.ts components/kiro tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add computer task review and undo"
```

---

### Task 3: Existing History + Audit + Regenerate + Offline V1 Regression

**Files:** `audit.ts`, Settings audit panel, `lib/ai/history/types.ts`, `sanitize.ts`, `useKiroChat.ts`, Settings/Conversation/TaskCard, history-audit test, focused E2E.

Persisted shape:
```ts
export interface PersistedComputerTaskView {
  taskId: string;
  title: string;
  status: "completed" | "failed" | "cancelled" | "undone" | "undo_failed";
  changes: Array<{
    operation: "create" | "modify";
    resourceType: "directory" | "text" | "document";
    displayName: string;
    workspaceLabel: string;
    rootLabel: string;
    relativePath: string;
    format?: "markdown" | "docx";
    size?: number;
    changeCount?: number;
    verification: "passed";
  }>;
  startedAt: string;
  completedAt?: string;
}
```
Add `computerTask?: PersistedComputerTaskView` to `PersistedKiroMessage`.

- [ ] Write history/audit tests: sanitizer strips review/beforeText/content preview/handle/adapterRef/native path/bytes/token/checkpoint; 510 audit records retain newest 500.
- [ ] Extend existing history pipeline. `KiroChatMessageView` gets live `computerTask?` and restored `historyComputerTask?`. `sanitizeConversation()` maps either to `PersistedKiroMessage.computerTask`, and retains assistant messages with Computer task even if text/actions are empty. `loadConversation()` restores Computer task view via `restoredComputerTasksRef`; restored task has no executable Undo.
- [ ] Include restored Computer mutation message ids in existing `restoredWriteMessageIds` edit-safety input. Mutation turns remain non-regenerable and are never automatically replayed. Read-only Computer turns keep existing behavior.
- [ ] Implement `classflow-kiro-computer-audit-v1`/`entries`, max 500, metadata only: timestamp/task/conversation/toolCall/tool/capability/decision/outcome/workspace/root/relativePath/verification. Settings shows latest 10 and allows clearing audit metadata without touching files/rules/history.
- [ ] Add deterministic Sandbox E2E. It must not call external AI. Reuse an existing mock helper; if none exists, intercept `/api/ai/chat` and emit deterministic AI SDK-compatible tool-call streams for two scripted turns: Workspace Auto creates `notes.md`; Guided patches it. Verify approval → allow once → same task resumes → review before/after → Undo restores → conversation reload restores display-only task without Undo.
- [ ] Final targeted verification:
```bash
npx vitest run \
  tests/unit/kiro-computer-approval.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts \
  tests/unit/kiro-computer-tools.test.ts

npx playwright test tests/e2e/kiro-computer-agent-v1.spec.ts
npm run typecheck
```
- [ ] Security audit:
```bash
grep -R -n \
  "FileSystemDirectoryHandle\|adapterRef\|absolutePath\|nativePath\|beforeText\|fileBytes\|showDirectoryPicker\|run_shell\|PowerShell\|delete_file\|delete_directory" \
  app hooks lib/ai/computer lib/ai/history store components/kiro components/settings
```
Review every hit. Sensitive values stay only in grants/adapters/checkpoints/tests; `showDirectoryPicker` stays in explicit grant helper; no model-facing shell/delete tools.
- [ ] Commit:
```bash
git add lib/ai/computer lib/ai/history hooks/useKiroChat.ts components/kiro components/settings tests
git commit -m "feat(kiro): complete computer agent v1 lifecycle"
```

Build is skipped by default. Run only for a demonstrated Next client/server or bundling issue not covered by typecheck.

---

## Acceptance

- Approval pauses `ask` with no mutation/tool output; it never overrides deny/hard boundaries.
- allow-once is exact; session rule is non-persistent; workspace rule is persistent/workspace-scoped; stale approvals clear safely.
- One factual Computer task per Computer-enabled turn, bound to owning assistant message/toolCallIds; no global Computer action footer.
- Review uses real exact patch/document facts and exposes no native path/adapterRef.
- Create text/doc/document/empty directory and patch support verified session Undo; no recursive deletion; checkpoint single-use/non-persistent.
- Existing Kiro conversation history persists display-only Computer task facts; restored task has no Undo and blocks mutation replay/edit bypass.
- Audit metadata is capped at 500 and latest activity is visible in Settings.
- Browser grant lookup is centralized in `workspace/grants.ts`.
- Four targeted Vitest files, one deterministic offline E2E, and typecheck pass; build skipped unless justified.

## Deferred Beyond V1

Model-facing delete/move/rename; app open/reveal; shell/PowerShell/cmd and Windows process sandbox; MCP/network permissions; Tauri/Windows adapter; parallel/background agents; persistent executable checkpoints across restart; full binary/document diff editor.

Part 3 must STOP after approval, message-owned task/review, session checkpoint/Undo, existing-history integration, audit metadata, regenerate hardening, and focused regression are complete.
